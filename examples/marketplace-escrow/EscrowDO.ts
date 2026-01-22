// Marketplace Escrow Durable Object
// Demonstrates: State machines, automatic timeouts, multi-party transactions, dispute resolution
// Key patterns: $.at scheduled callbacks, $.send events, atomic state transitions

import { Hono } from 'hono'
import { DO, type DOEnv, createContext } from '@dotdo/do'
import type {
  Escrow,
  EscrowStatus,
  Dispute,
  DisputeReason,
  DisputeStatus,
  Evidence,
  DisputeResolution,
  Order,
  FeeCalculation,
} from './types'

// Fee configuration
const PLATFORM_FEE_RATE = 0.025 // 2.5%
const ESCROW_FEE_RATE = 0.005 // 0.5%

// Default deadlines
const DEFAULT_INSPECTION_DAYS = 3
const DEFAULT_DELIVERY_DAYS = 5
const EVIDENCE_PERIOD_DAYS = 7
const RESOLUTION_DEADLINE_DAYS = 14

export class EscrowDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // ========================================================================
    // Event Handlers
    // ========================================================================

    // Handle escrow funded - start delivery countdown
    this.$.on.Escrow.funded(async (event) => {
      const { escrowId } = (event as { type: string; payload: { escrowId: string } }).payload
      console.log(`[Event] Escrow funded: ${escrowId}`)
      // Notify seller to ship
    })

    // Handle escrow delivered - start inspection period
    this.$.on.Escrow.delivered(async (event) => {
      const { escrowId } = (event as { type: string; payload: { escrowId: string } }).payload
      console.log(`[Event] Escrow marked delivered: ${escrowId}`)
      // Notify buyer to inspect
    })

    // Handle escrow released - transfer funds to seller
    this.$.on.Escrow.released(async (event) => {
      const { escrowId, amount } = (event as { type: string; payload: { escrowId: string; amount: number } }).payload
      console.log(`[Event] Escrow released: ${escrowId}, amount: $${amount}`)
      // In production: initiate payout to seller
    })

    // Handle dispute opened - notify arbiter
    this.$.on.Dispute.opened(async (event) => {
      const { disputeId, escrowId, reason } = (event as { type: string; payload: { disputeId: string; escrowId: string; reason: string } }).payload
      console.log(`[Event] Dispute opened: ${disputeId} for escrow ${escrowId}, reason: ${reason}`)
      // Notify arbiter
    })

    // Handle dispute resolved - distribute funds
    this.$.on.Dispute.resolved(async (event) => {
      const { disputeId, buyerAmount, sellerAmount } = (event as { type: string; payload: { disputeId: string; buyerAmount: number; sellerAmount: number } }).payload
      console.log(`[Event] Dispute resolved: ${disputeId}, buyer: $${buyerAmount}, seller: $${sellerAmount}`)
      // In production: distribute funds
    })

    // Wildcard handler for audit logging
    this.$.on['*']['*'](async (event) => {
      const e = event as { type: string; payload: unknown }
      console.log(`[Audit] ${e.type}`, e.payload)
    })

    // ========================================================================
    // Scheduled Tasks
    // ========================================================================

    // Every hour - check for deadline expirations
    this.$.every.hour(async () => {
      console.log('[Scheduled] Checking escrow deadlines...')
      await this.checkDeadlines()
    })
  }

  private async checkDeadlines(): Promise<void> {
    const now = new Date().toISOString()
    const escrows = await this.things.list({ type: 'Escrow' })

    for (const escrow of escrows) {
      const e = escrow as unknown as Escrow

      // Auto-refund if delivery deadline passed while funded
      if (e.status === 'funded' && e.deliveryDeadline < now) {
        await this.refundEscrow(escrow.$id, 'DELIVERY_TIMEOUT')
      }

      // Auto-release if inspection deadline passed while delivered
      if (e.status === 'delivered' && e.inspectionDeadline < now) {
        await this.releaseEscrow(escrow.$id)
      }
    }

    // Check dispute deadlines
    const disputes = await this.things.list({ type: 'Dispute' })
    for (const dispute of disputes) {
      const d = dispute as unknown as Dispute

      // Auto-escalate if resolution deadline passed
      if (d.status === 'under_review' && d.resolutionDeadline < now) {
        await this.things.update(dispute.$id, {
          status: 'escalated',
          escalatedTo: 'senior-arbiter',
        })
        this.$.send({
          type: 'Dispute.escalated',
          payload: { disputeId: dispute.$id, to: 'senior-arbiter' },
        })
      }
    }
  }

  private calculateFees(amount: number): FeeCalculation {
    const platformFee = Math.round(amount * PLATFORM_FEE_RATE * 100) / 100
    const escrowFee = Math.round(amount * ESCROW_FEE_RATE * 100) / 100
    const totalFees = platformFee + escrowFee
    return {
      subtotal: amount,
      platformFee,
      escrowFee,
      totalFees,
      sellerReceives: amount - totalFees,
    }
  }

  private async refundEscrow(escrowId: string, reason: string): Promise<void> {
    const escrow = await this.things.get(escrowId)
    if (!escrow || escrow.$type !== 'Escrow') return

    await this.things.update(escrowId, {
      status: 'refunded',
      cancelledAt: new Date().toISOString(),
    })

    this.$.send({
      type: 'Escrow.refunded',
      payload: { escrowId, reason },
    })
  }

  private async releaseEscrow(escrowId: string): Promise<void> {
    const escrow = await this.things.get(escrowId)
    if (!escrow || escrow.$type !== 'Escrow') return

    const e = escrow as unknown as Escrow
    const fees = this.calculateFees(e.amount)

    await this.things.update(escrowId, {
      status: 'released',
      releasedAt: new Date().toISOString(),
    })

    this.$.send({
      type: 'Escrow.released',
      payload: {
        escrowId,
        amount: fees.sellerReceives,
        sellerId: e.sellerId,
      },
    })
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Escrow Lifecycle
    // ========================================================================

    // Create new escrow
    app.post('/escrows', async (c) => {
      const data = await c.req.json<{
        buyerId: string
        sellerId: string
        amount: number
        currency?: string
        itemDescription: string
        inspectionDays?: number
        deliveryDays?: number
      }>()

      const now = new Date()
      const inspectionDays = data.inspectionDays ?? DEFAULT_INSPECTION_DAYS
      const deliveryDays = data.deliveryDays ?? DEFAULT_DELIVERY_DAYS

      const inspectionDeadline = new Date(now.getTime() + (inspectionDays + deliveryDays) * 24 * 60 * 60 * 1000)
      const deliveryDeadline = new Date(now.getTime() + deliveryDays * 24 * 60 * 60 * 1000)

      const escrow = await this.things.create({
        $type: 'Escrow',
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        amount: data.amount,
        currency: data.currency ?? 'USD',
        itemDescription: data.itemDescription,
        status: 'pending' as EscrowStatus,
        arbiter: 'platform',
        inspectionDeadline: inspectionDeadline.toISOString(),
        deliveryDeadline: deliveryDeadline.toISOString(),
      })

      this.$.send({
        type: 'Escrow.created',
        payload: { escrowId: escrow.$id, buyerId: data.buyerId, sellerId: data.sellerId },
      })

      return c.json(escrow, 201)
    })

    // Get escrow details
    app.get('/escrows/:id', async (c) => {
      const escrow = await this.things.get(c.req.param('id'))
      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }
      return c.json(escrow)
    })

    // Fund escrow (buyer)
    app.post('/escrows/:id/fund', async (c) => {
      const escrowId = c.req.param('id')
      const escrow = await this.things.get(escrowId)

      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const e = escrow as unknown as Escrow
      if (e.status !== 'pending') {
        return c.json({ error: 'Escrow is not pending' }, 400)
      }

      // In production: process payment via Stripe/Plaid
      const now = new Date()
      const deliveryDeadline = new Date(now.getTime() + DEFAULT_DELIVERY_DAYS * 24 * 60 * 60 * 1000)

      const updated = await this.things.update(escrowId, {
        status: 'funded',
        fundedAt: now.toISOString(),
        deliveryDeadline: deliveryDeadline.toISOString(),
      })

      this.$.send({
        type: 'Escrow.funded',
        payload: { escrowId, amount: e.amount },
      })

      return c.json(updated)
    })

    // Mark as delivered (seller)
    app.post('/escrows/:id/deliver', async (c) => {
      const escrowId = c.req.param('id')
      const { trackingNumber, carrier } = await c.req.json<{
        trackingNumber?: string
        carrier?: string
      }>()

      const escrow = await this.things.get(escrowId)
      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const e = escrow as unknown as Escrow
      if (e.status !== 'funded') {
        return c.json({ error: 'Escrow is not funded' }, 400)
      }

      const now = new Date()
      const inspectionDeadline = new Date(now.getTime() + DEFAULT_INSPECTION_DAYS * 24 * 60 * 60 * 1000)

      const updated = await this.things.update(escrowId, {
        status: 'delivered',
        deliveredAt: now.toISOString(),
        inspectionDeadline: inspectionDeadline.toISOString(),
        trackingNumber,
        carrier,
      })

      this.$.send({
        type: 'Escrow.delivered',
        payload: { escrowId, trackingNumber },
      })

      return c.json(updated)
    })

    // Confirm receipt (buyer)
    app.post('/escrows/:id/confirm', async (c) => {
      const escrowId = c.req.param('id')
      const { rating } = await c.req.json<{ rating?: number }>()

      const escrow = await this.things.get(escrowId)
      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const e = escrow as unknown as Escrow
      if (e.status !== 'delivered') {
        return c.json({ error: 'Escrow is not in delivered state' }, 400)
      }

      await this.releaseEscrow(escrowId)
      const updated = await this.things.get(escrowId)

      return c.json(updated)
    })

    // Cancel escrow
    app.post('/escrows/:id/cancel', async (c) => {
      const escrowId = c.req.param('id')
      const escrow = await this.things.get(escrowId)

      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const e = escrow as unknown as Escrow
      if (!['pending', 'funded'].includes(e.status)) {
        return c.json({ error: 'Cannot cancel escrow in current state' }, 400)
      }

      const updated = await this.things.update(escrowId, {
        status: e.status === 'funded' ? 'refunded' : 'cancelled',
        cancelledAt: new Date().toISOString(),
      })

      this.$.send({
        type: e.status === 'funded' ? 'Escrow.refunded' : 'Escrow.cancelled',
        payload: { escrowId, reason: 'User requested cancellation' },
      })

      return c.json(updated)
    })

    // Get escrow timeline
    app.get('/escrows/:id/timeline', async (c) => {
      const escrowId = c.req.param('id')
      const events = await this.events.query({ source: escrowId })
      return c.json(events)
    })

    // Calculate fees
    app.get('/escrows/:id/fees', async (c) => {
      const escrow = await this.things.get(c.req.param('id'))
      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const e = escrow as unknown as Escrow
      return c.json(this.calculateFees(e.amount))
    })

    // ========================================================================
    // Dispute Management
    // ========================================================================

    // Open dispute
    app.post('/escrows/:id/dispute', async (c) => {
      const escrowId = c.req.param('id')
      const data = await c.req.json<{
        reason: DisputeReason
        description: string
        evidence?: Omit<Evidence, 'id' | 'submittedAt' | 'submittedBy'>[]
      }>()

      const escrow = await this.things.get(escrowId)
      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const e = escrow as unknown as Escrow
      if (!['funded', 'delivered'].includes(e.status)) {
        return c.json({ error: 'Cannot dispute escrow in current state' }, 400)
      }

      const now = new Date()
      const evidenceDeadline = new Date(now.getTime() + EVIDENCE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
      const resolutionDeadline = new Date(now.getTime() + (EVIDENCE_PERIOD_DAYS + RESOLUTION_DEADLINE_DAYS) * 24 * 60 * 60 * 1000)

      const evidence: Evidence[] = (data.evidence ?? []).map((ev, i) => ({
        id: `ev_${Date.now()}_${i}`,
        ...ev,
        submittedBy: 'buyer' as const,
        submittedAt: now.toISOString(),
      }))

      const dispute = await this.things.create({
        $type: 'Dispute',
        escrowId,
        buyerId: e.buyerId,
        sellerId: e.sellerId,
        reason: data.reason,
        description: data.description,
        status: 'evidence_period' as DisputeStatus,
        evidence,
        evidenceDeadline: evidenceDeadline.toISOString(),
        resolutionDeadline: resolutionDeadline.toISOString(),
        createdAt: now.toISOString(),
      })

      // Update escrow status
      await this.things.update(escrowId, { status: 'disputed' })

      this.$.send({
        type: 'Dispute.opened',
        payload: { disputeId: dispute.$id, escrowId, reason: data.reason },
      })

      return c.json(dispute, 201)
    })

    // Get dispute
    app.get('/disputes/:id', async (c) => {
      const dispute = await this.things.get(c.req.param('id'))
      if (!dispute || dispute.$type !== 'Dispute') {
        return c.json({ error: 'Dispute not found' }, 404)
      }
      return c.json(dispute)
    })

    // Add evidence to dispute
    app.post('/disputes/:id/evidence', async (c) => {
      const disputeId = c.req.param('id')
      const data = await c.req.json<{
        submittedBy: 'buyer' | 'seller'
        type: Evidence['type']
        url: string
        description: string
      }>()

      const dispute = await this.things.get(disputeId)
      if (!dispute || dispute.$type !== 'Dispute') {
        return c.json({ error: 'Dispute not found' }, 404)
      }

      const d = dispute as unknown as Dispute
      if (d.status !== 'evidence_period') {
        return c.json({ error: 'Evidence period has ended' }, 400)
      }

      const newEvidence: Evidence = {
        id: `ev_${Date.now()}`,
        type: data.type,
        url: data.url,
        description: data.description,
        submittedBy: data.submittedBy,
        submittedAt: new Date().toISOString(),
      }

      const updated = await this.things.update(disputeId, {
        evidence: [...d.evidence, newEvidence],
      })

      return c.json(updated)
    })

    // Resolve dispute (arbiter only)
    app.post('/disputes/:id/resolve', async (c) => {
      const disputeId = c.req.param('id')
      const data = await c.req.json<{
        decision: DisputeResolution['decision']
        buyerAmount: number
        sellerAmount: number
        notes: string
        resolvedBy: string
      }>()

      const dispute = await this.things.get(disputeId)
      if (!dispute || dispute.$type !== 'Dispute') {
        return c.json({ error: 'Dispute not found' }, 404)
      }

      const d = dispute as unknown as Dispute
      if (!['evidence_period', 'under_review'].includes(d.status)) {
        return c.json({ error: 'Cannot resolve dispute in current state' }, 400)
      }

      const resolution: DisputeResolution = {
        decision: data.decision,
        buyerAmount: data.buyerAmount,
        sellerAmount: data.sellerAmount,
        notes: data.notes,
        resolvedBy: data.resolvedBy,
        resolvedAt: new Date().toISOString(),
      }

      const updated = await this.things.update(disputeId, {
        status: 'resolved',
        resolution,
        resolvedAt: resolution.resolvedAt,
      })

      // Update escrow status
      await this.things.update(d.escrowId, { status: 'resolved' })

      this.$.send({
        type: 'Dispute.resolved',
        payload: {
          disputeId,
          escrowId: d.escrowId,
          decision: data.decision,
          buyerAmount: data.buyerAmount,
          sellerAmount: data.sellerAmount,
        },
      })

      return c.json(updated)
    })

    // Get dispute timeline
    app.get('/disputes/:id/timeline', async (c) => {
      const disputeId = c.req.param('id')
      const events = await this.events.query({ source: disputeId })
      return c.json(events)
    })

    // ========================================================================
    // Order Tracking
    // ========================================================================

    // Get order for escrow
    app.get('/orders/:escrowId', async (c) => {
      const escrowId = c.req.param('escrowId')
      const orders = await this.things.list({ type: 'Order' })
      const order = orders.find((o) => (o as unknown as Order).escrowId === escrowId)

      if (!order) {
        return c.json({ error: 'Order not found' }, 404)
      }
      return c.json(order)
    })

    // Get tracking info
    app.get('/orders/:escrowId/tracking', async (c) => {
      const escrow = await this.things.get(c.req.param('escrowId'))
      if (!escrow || escrow.$type !== 'Escrow') {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const e = escrow as unknown as Escrow
      return c.json({
        trackingNumber: e.trackingNumber,
        carrier: e.carrier,
        status: e.status,
        deliveredAt: e.deliveredAt,
      })
    })
  }
}

// Export for worker binding
export { EscrowDO as DO }
