/**
 * DisputeDO - Dispute Resolution Durable Object
 *
 * Manages disputes between buyers and sellers in escrow transactions.
 * Implements evidence collection, escalation, and resolution workflow.
 *
 * Dispute Lifecycle:
 * ```
 * OPENED -> EVIDENCE_PERIOD -> UNDER_REVIEW -> RESOLVED
 *              |                    |
 *              v                    v
 *           ESCALATED ----------> RESOLVED
 * ```
 *
 * Events Emitted:
 * - Dispute.opened - New dispute created
 * - Dispute.evidenceAdded - Evidence submitted
 * - Dispute.evidencePeriodEnded - Evidence collection closed
 * - Dispute.escalated - Escalated to senior arbiter
 * - Dispute.underReview - Arbiter reviewing
 * - Dispute.resolved - Resolution decided
 */

import { DO } from 'dotdo'
import type { TimelineEvent } from '../types'

// ============================================================================
// TYPES
// ============================================================================

export type DisputeStatus =
  | 'opened' // Just opened, collecting initial evidence
  | 'evidence_period' // Both parties can submit evidence
  | 'under_review' // Arbiter reviewing evidence
  | 'escalated' // Escalated to senior arbiter
  | 'resolved' // Final decision made

export type DisputeReason =
  | 'ITEM_NOT_RECEIVED'
  | 'ITEM_NOT_AS_DESCRIBED'
  | 'ITEM_DAMAGED'
  | 'WRONG_ITEM'
  | 'COUNTERFEIT'
  | 'SELLER_NON_DELIVERY'
  | 'BUYER_NON_PAYMENT'
  | 'OTHER'

export type ResolutionDecision =
  | 'FULL_REFUND' // 100% to buyer
  | 'PARTIAL_REFUND' // Split between buyer and seller
  | 'RELEASE_TO_SELLER' // 100% to seller
  | 'SPLIT' // 50/50 split

export interface Evidence {
  id: string
  type: 'photo' | 'video' | 'document' | 'message' | 'tracking' | 'screenshot'
  url: string
  description: string
  submittedBy: 'buyer' | 'seller'
  submittedAt: string
}

export interface Dispute {
  id: string
  escrowId: string
  orderId?: string
  buyer: string
  seller: string
  arbiter: string
  amount: number
  reason: DisputeReason
  description: string
  status: DisputeStatus
  openedBy: 'buyer' | 'seller'
  buyerEvidence: Evidence[]
  sellerEvidence: Evidence[]
  sellerResponse?: string
  sellerRespondedAt?: string
  resolution?: Resolution
  evidenceDeadline: string
  escalationDeadline?: string
  timeline: TimelineEvent[]
  createdAt: string
  updatedAt: string
}

export interface Resolution {
  id: string
  decision: ResolutionDecision
  buyerAmount: number
  sellerAmount: number
  notes: string
  resolvedBy: string
  resolvedAt: string
}

export interface OpenDisputeRequest {
  escrowId: string
  orderId?: string
  buyer: string
  seller: string
  arbiter?: string
  amount: number
  reason: DisputeReason
  description: string
  openedBy: 'buyer' | 'seller'
  evidence?: Array<{
    type: Evidence['type']
    url: string
    description: string
  }>
}

export interface AddEvidenceRequest {
  type: Evidence['type']
  url: string
  description: string
  submittedBy: 'buyer' | 'seller'
}

export interface ResolveDisputeRequest {
  decision: ResolutionDecision
  buyerAmount: number
  sellerAmount: number
  notes: string
  resolvedBy: string
}

// ============================================================================
// ERROR CLASS
// ============================================================================

export class DisputeError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'DisputeError'
  }
}

// ============================================================================
// DISPUTE DURABLE OBJECT
// ============================================================================

export class DisputeDO extends DO {
  static readonly $type = 'DisputeDO'

  // Default configuration
  private readonly EVIDENCE_PERIOD_DAYS = 7
  private readonly ESCALATION_PERIOD_DAYS = 14

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // TIMEOUT HANDLERS
    // ========================================================================

    /**
     * Handle evidence period timeout
     */
    this.$.on.Dispute.evidenceTimeout(async (event) => {
      const { disputeId } = event.data as { disputeId: string }

      if (disputeId !== this.ns) return

      const dispute = await this.getDispute()
      if (!dispute) return
      if (dispute.status !== 'evidence_period') return

      console.log(`[Dispute.evidenceTimeout] Closing evidence period for ${disputeId}`)

      await this.closeEvidencePeriod()
    })

    /**
     * Handle escalation timeout - auto-escalate if not resolved
     */
    this.$.on.Dispute.escalationTimeout(async (event) => {
      const { disputeId } = event.data as { disputeId: string }

      if (disputeId !== this.ns) return

      const dispute = await this.getDispute()
      if (!dispute) return
      if (dispute.status !== 'under_review') return

      console.log(`[Dispute.escalationTimeout] Auto-escalating ${disputeId}`)

      await this.escalate('Resolution deadline exceeded')
    })

    // ========================================================================
    // NOTIFICATION HANDLERS
    // ========================================================================

    this.$.on.Dispute.opened(async (event) => {
      const { disputeId, escrowId, buyer, seller, reason, openedBy } = event.data as {
        disputeId: string
        escrowId: string
        buyer: string
        seller: string
        reason: string
        openedBy: string
      }

      console.log(`[Dispute.opened] Dispute ${disputeId} opened for escrow ${escrowId}`)

      // Notify the other party
      const notifyParty = openedBy === 'buyer' ? seller : buyer
      this.$.send('Email.notify', {
        to: notifyParty,
        template: 'dispute_opened',
        data: { disputeId, escrowId, reason },
      })

      // Notify arbiter
      this.$.send('Arbiter.notify', {
        disputeId,
        escrowId,
        type: 'new_dispute',
        priority: 'normal',
      })
    })

    this.$.on.Dispute.resolved(async (event) => {
      const { disputeId, escrowId, buyer, seller, buyerAmount, sellerAmount, decision } = event.data as {
        disputeId: string
        escrowId: string
        buyer: string
        seller: string
        buyerAmount: number
        sellerAmount: number
        decision: string
      }

      console.log(`[Dispute.resolved] Dispute ${disputeId} resolved: ${decision}`)

      // Notify both parties
      this.$.send('Email.notify', {
        to: buyer,
        template: 'dispute_resolved',
        data: { disputeId, decision, amount: buyerAmount, role: 'buyer' },
      })

      this.$.send('Email.notify', {
        to: seller,
        template: 'dispute_resolved',
        data: { disputeId, decision, amount: sellerAmount, role: 'seller' },
      })
    })

    console.log('[DisputeDO] Event handlers registered')
  }

  // ==========================================================================
  // DISPUTE LIFECYCLE METHODS
  // ==========================================================================

  /**
   * Open a new dispute.
   */
  async openDispute(request: OpenDisputeRequest): Promise<Dispute> {
    const existing = await this.getDispute()
    if (existing) {
      throw new DisputeError('Dispute already exists', 'ALREADY_EXISTS')
    }

    const id = this.ns
    const now = new Date().toISOString()

    // Process initial evidence
    const initialEvidence: Evidence[] = (request.evidence ?? []).map((e, i) => ({
      id: `ev_${crypto.randomUUID().slice(0, 8)}`,
      type: e.type,
      url: e.url,
      description: e.description,
      submittedBy: request.openedBy,
      submittedAt: now,
    }))

    const dispute: Dispute = {
      id,
      escrowId: request.escrowId,
      orderId: request.orderId,
      buyer: request.buyer,
      seller: request.seller,
      arbiter: request.arbiter ?? 'platform',
      amount: request.amount,
      reason: request.reason,
      description: request.description,
      status: 'opened',
      openedBy: request.openedBy,
      buyerEvidence: request.openedBy === 'buyer' ? initialEvidence : [],
      sellerEvidence: request.openedBy === 'seller' ? initialEvidence : [],
      evidenceDeadline: this.calculateDeadline(this.EVIDENCE_PERIOD_DAYS),
      timeline: [
        {
          event: 'Dispute.opened',
          timestamp: now,
          actor: request.openedBy === 'buyer' ? request.buyer : request.seller,
          details: {
            reason: request.reason,
            evidenceCount: initialEvidence.length,
          },
        },
      ],
      createdAt: now,
      updatedAt: now,
    }

    await this.ctx.storage.put('dispute', dispute)

    // Transition to evidence period
    await this.startEvidencePeriod()

    // Notify escrow to freeze funds
    this.$.send('Escrow.markDisputed', {
      escrowId: request.escrowId,
      disputeId: id,
      openedBy: request.openedBy,
      reason: request.reason,
    })

    this.$.send('Dispute.opened', {
      disputeId: id,
      escrowId: request.escrowId,
      buyer: request.buyer,
      seller: request.seller,
      reason: request.reason,
      openedBy: request.openedBy,
    })

    return dispute
  }

  /**
   * Start evidence collection period.
   */
  private async startEvidencePeriod(): Promise<Dispute> {
    const dispute = await this.getDisputeOrThrow()
    const now = new Date().toISOString()

    dispute.status = 'evidence_period'
    dispute.updatedAt = now

    dispute.timeline.push({
      event: 'Dispute.evidencePeriodStarted',
      timestamp: now,
      details: { deadline: dispute.evidenceDeadline },
    })

    await this.ctx.storage.put('dispute', dispute)

    // Schedule evidence deadline
    this.scheduleTimeout('evidenceTimeout', this.EVIDENCE_PERIOD_DAYS)

    this.$.send('Dispute.evidencePeriodStarted', {
      disputeId: dispute.id,
      deadline: dispute.evidenceDeadline,
    })

    return dispute
  }

  /**
   * Add evidence to dispute.
   */
  async addEvidence(request: AddEvidenceRequest): Promise<Dispute> {
    const dispute = await this.getDisputeOrThrow()

    if (!['opened', 'evidence_period'].includes(dispute.status)) {
      throw new DisputeError('Evidence period has ended', 'EVIDENCE_PERIOD_CLOSED')
    }

    const now = new Date().toISOString()

    const evidence: Evidence = {
      id: `ev_${crypto.randomUUID().slice(0, 8)}`,
      type: request.type,
      url: request.url,
      description: request.description,
      submittedBy: request.submittedBy,
      submittedAt: now,
    }

    if (request.submittedBy === 'buyer') {
      dispute.buyerEvidence.push(evidence)
    } else {
      dispute.sellerEvidence.push(evidence)
    }

    dispute.updatedAt = now

    dispute.timeline.push({
      event: 'Dispute.evidenceAdded',
      timestamp: now,
      actor: request.submittedBy === 'buyer' ? dispute.buyer : dispute.seller,
      details: {
        evidenceId: evidence.id,
        type: evidence.type,
      },
    })

    await this.ctx.storage.put('dispute', dispute)

    this.$.send('Dispute.evidenceAdded', {
      disputeId: dispute.id,
      evidenceId: evidence.id,
      submittedBy: request.submittedBy,
      type: evidence.type,
    })

    return dispute
  }

  /**
   * Seller responds to dispute.
   */
  async submitSellerResponse(response: string): Promise<Dispute> {
    const dispute = await this.getDisputeOrThrow()

    if (!['opened', 'evidence_period'].includes(dispute.status)) {
      throw new DisputeError('Cannot respond at this stage', 'INVALID_STATE')
    }

    const now = new Date().toISOString()

    dispute.sellerResponse = response
    dispute.sellerRespondedAt = now
    dispute.updatedAt = now

    dispute.timeline.push({
      event: 'Dispute.sellerResponded',
      timestamp: now,
      actor: dispute.seller,
      details: { responseLength: response.length },
    })

    await this.ctx.storage.put('dispute', dispute)

    this.$.send('Dispute.sellerResponded', {
      disputeId: dispute.id,
      seller: dispute.seller,
    })

    return dispute
  }

  /**
   * Close evidence period and move to review.
   */
  async closeEvidencePeriod(): Promise<Dispute> {
    const dispute = await this.getDisputeOrThrow()
    const now = new Date().toISOString()

    dispute.status = 'under_review'
    dispute.escalationDeadline = this.calculateDeadline(this.ESCALATION_PERIOD_DAYS)
    dispute.updatedAt = now

    dispute.timeline.push({
      event: 'Dispute.evidencePeriodEnded',
      timestamp: now,
      details: {
        buyerEvidenceCount: dispute.buyerEvidence.length,
        sellerEvidenceCount: dispute.sellerEvidence.length,
        hasSellerResponse: !!dispute.sellerResponse,
      },
    })

    await this.ctx.storage.put('dispute', dispute)

    // Schedule escalation deadline
    this.scheduleTimeout('escalationTimeout', this.ESCALATION_PERIOD_DAYS)

    this.$.send('Dispute.evidencePeriodEnded', {
      disputeId: dispute.id,
      escrowId: dispute.escrowId,
    })

    this.$.send('Dispute.underReview', {
      disputeId: dispute.id,
      arbiter: dispute.arbiter,
    })

    return dispute
  }

  /**
   * Escalate dispute to senior arbiter.
   */
  async escalate(reason: string): Promise<Dispute> {
    const dispute = await this.getDisputeOrThrow()
    const now = new Date().toISOString()

    const previousArbiter = dispute.arbiter
    dispute.status = 'escalated'
    dispute.arbiter = 'senior-arbiter'
    dispute.updatedAt = now

    dispute.timeline.push({
      event: 'Dispute.escalated',
      timestamp: now,
      details: {
        reason,
        previousArbiter,
        newArbiter: 'senior-arbiter',
      },
    })

    await this.ctx.storage.put('dispute', dispute)

    this.$.send('Dispute.escalated', {
      disputeId: dispute.id,
      escrowId: dispute.escrowId,
      reason,
      previousArbiter,
      newArbiter: 'senior-arbiter',
    })

    // Notify senior arbiter
    this.$.send('Arbiter.notify', {
      disputeId: dispute.id,
      escrowId: dispute.escrowId,
      type: 'escalation',
      priority: 'high',
    })

    return dispute
  }

  /**
   * Resolve the dispute (arbiter action).
   */
  async resolveDispute(request: ResolveDisputeRequest): Promise<Dispute> {
    const dispute = await this.getDisputeOrThrow()

    if (!['under_review', 'escalated'].includes(dispute.status)) {
      throw new DisputeError('Dispute not ready for resolution', 'INVALID_STATE')
    }

    // Validate amounts
    const totalDistribution = request.buyerAmount + request.sellerAmount
    if (Math.abs(totalDistribution - dispute.amount) > 0.01) {
      throw new DisputeError(
        'Distribution must equal escrow amount',
        'INVALID_DISTRIBUTION',
        { expected: dispute.amount, got: totalDistribution }
      )
    }

    const now = new Date().toISOString()

    dispute.status = 'resolved'
    dispute.resolution = {
      id: `res_${crypto.randomUUID().slice(0, 8)}`,
      decision: request.decision,
      buyerAmount: request.buyerAmount,
      sellerAmount: request.sellerAmount,
      notes: request.notes,
      resolvedBy: request.resolvedBy,
      resolvedAt: now,
    }
    dispute.updatedAt = now

    dispute.timeline.push({
      event: 'Dispute.resolved',
      timestamp: now,
      actor: request.resolvedBy,
      details: {
        decision: request.decision,
        buyerAmount: request.buyerAmount,
        sellerAmount: request.sellerAmount,
      },
    })

    await this.ctx.storage.put('dispute', dispute)

    // Cancel any pending timeouts
    this.cancelAllTimeouts()

    // Notify escrow to distribute funds
    this.$.send('Escrow.markResolved', {
      escrowId: dispute.escrowId,
      disputeId: dispute.id,
      decision: request.decision,
      buyerAmount: request.buyerAmount,
      sellerAmount: request.sellerAmount,
      notes: request.notes,
    })

    this.$.send('Dispute.resolved', {
      disputeId: dispute.id,
      escrowId: dispute.escrowId,
      buyer: dispute.buyer,
      seller: dispute.seller,
      decision: request.decision,
      buyerAmount: request.buyerAmount,
      sellerAmount: request.sellerAmount,
    })

    return dispute
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * Get dispute details.
   */
  async getDispute(): Promise<Dispute | null> {
    return (await this.ctx.storage.get<Dispute>('dispute')) ?? null
  }

  /**
   * Get dispute or throw if not found.
   */
  private async getDisputeOrThrow(): Promise<Dispute> {
    const dispute = await this.getDispute()
    if (!dispute) {
      throw new DisputeError('Dispute not found', 'NOT_FOUND')
    }
    return dispute
  }

  /**
   * Get all evidence.
   */
  async getEvidence(): Promise<{
    buyerEvidence: Evidence[]
    sellerEvidence: Evidence[]
    total: number
  }> {
    const dispute = await this.getDispute()
    if (!dispute) {
      return { buyerEvidence: [], sellerEvidence: [], total: 0 }
    }

    return {
      buyerEvidence: dispute.buyerEvidence,
      sellerEvidence: dispute.sellerEvidence,
      total: dispute.buyerEvidence.length + dispute.sellerEvidence.length,
    }
  }

  /**
   * Get dispute timeline.
   */
  async getTimeline(): Promise<TimelineEvent[]> {
    const dispute = await this.getDispute()
    return dispute?.timeline ?? []
  }

  /**
   * Get dispute summary for arbiter.
   */
  async getArbiterSummary(): Promise<{
    dispute: Dispute | null
    buyerEvidenceCount: number
    sellerEvidenceCount: number
    hasSellerResponse: boolean
    daysOpen: number
    isEscalated: boolean
  } | null> {
    const dispute = await this.getDispute()
    if (!dispute) return null

    const daysOpen = Math.floor(
      (Date.now() - new Date(dispute.createdAt).getTime()) / (24 * 60 * 60 * 1000)
    )

    return {
      dispute,
      buyerEvidenceCount: dispute.buyerEvidence.length,
      sellerEvidenceCount: dispute.sellerEvidence.length,
      hasSellerResponse: !!dispute.sellerResponse,
      daysOpen,
      isEscalated: dispute.status === 'escalated',
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

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

    this.ctx.storage.put(`timeout:${type}`, {
      type,
      scheduledFor: new Date(alarmTime).toISOString(),
      disputeId: this.ns,
    })

    console.log(`[DisputeDO] Scheduled ${type} for ${new Date(alarmTime).toISOString()}`)
  }

  /**
   * Cancel all pending timeouts.
   */
  private cancelAllTimeouts(): void {
    this.ctx.storage.delete('timeout:evidenceTimeout')
    this.ctx.storage.delete('timeout:escalationTimeout')
  }

  /**
   * Handle alarm (called by DO runtime).
   */
  async alarm(): Promise<void> {
    const evidenceTimeout = await this.ctx.storage.get('timeout:evidenceTimeout')
    const escalationTimeout = await this.ctx.storage.get('timeout:escalationTimeout')

    if (evidenceTimeout) {
      this.$.send('Dispute.evidenceTimeout', { disputeId: this.ns })
      await this.ctx.storage.delete('timeout:evidenceTimeout')
    }

    if (escalationTimeout) {
      this.$.send('Dispute.escalationTimeout', { disputeId: this.ns })
      await this.ctx.storage.delete('timeout:escalationTimeout')
    }
  }
}
