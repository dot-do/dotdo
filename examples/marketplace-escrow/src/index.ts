/**
 * Marketplace Escrow - Worker Entry Point
 *
 * Trust-minimized escrow for marketplace transactions.
 * Multi-party (buyer, seller, arbiter) with automatic timeouts and dispute resolution.
 *
 * Architecture:
 * - EscrowDO: Manages escrow lifecycle and fund custody
 * - OrderDO: Tracks shipment and delivery status
 * - DisputeDO: Handles dispute resolution workflow
 *
 * @module marketplace-escrow
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  Env,
  Escrow,
  Order,
  Dispute,
  CreateEscrowRequest,
  FundEscrowRequest,
  DeliverRequest,
  DisputeRequest,
  ResolveRequest,
  FeeDistribution,
} from './types'

// Re-export DO classes for Wrangler
export { EscrowDO } from './objects/Escrow'
export { OrderDO } from './objects/Order'
export { DisputeDO } from './objects/Dispute'

// ============================================================================
// API ERROR CLASS
// ============================================================================

class APIError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: ContentfulStatusCode = 400,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'APIError'
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Call DO method via RPC.
 */
async function callDO<T>(
  stub: DurableObjectStub,
  method: string,
  args: unknown[] = []
): Promise<T> {
  const response = await stub.fetch('https://internal/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: args,
    }),
  })

  const result = (await response.json()) as {
    result?: T
    error?: { message: string; code?: string }
  }

  if (result.error) {
    throw new APIError(result.error.message, result.error.code ?? 'ERROR')
  }

  return result.result as T
}

/**
 * Get user identity from request (simplified - in production use auth).
 */
function getIdentity(c: { req: { header: (name: string) => string | undefined } }): {
  userId: string
  role: 'buyer' | 'seller' | 'arbiter'
} {
  return {
    userId: c.req.header('X-User-ID') ?? 'anonymous',
    role: (c.req.header('X-User-Role') as 'buyer' | 'seller' | 'arbiter') ?? 'buyer',
  }
}

// ============================================================================
// CREATE API
// ============================================================================

function createAPI() {
  const app = new Hono<{ Bindings: Env }>()

  // Enable CORS
  app.use('*', cors())

  // ==========================================================================
  // ROOT - API DOCUMENTATION
  // ==========================================================================

  app.get('/', (c) => {
    return c.json({
      name: 'Marketplace Escrow API',
      version: '1.0.0',
      tagline: 'Trust nobody. Let the code hold the money.',
      description:
        'Multi-party escrow for marketplace transactions with automatic timeouts and dispute resolution',
      architecture: {
        EscrowDO: 'Escrow lifecycle and fund custody',
        OrderDO: 'Shipment and delivery tracking',
        DisputeDO: 'Dispute resolution workflow',
      },
      endpoints: {
        escrow: {
          'POST /escrows': 'Create new escrow',
          'GET /escrows/:id': 'Get escrow details',
          'POST /escrows/:id/fund': 'Fund the escrow (buyer)',
          'POST /escrows/:id/deliver': 'Mark as delivered (seller)',
          'POST /escrows/:id/confirm': 'Confirm receipt (buyer)',
          'POST /escrows/:id/cancel': 'Cancel escrow',
          'GET /escrows/:id/timeline': 'Get escrow event history',
          'GET /escrows/:id/fees': 'Calculate fee distribution',
        },
        order: {
          'GET /orders/:id': 'Get order details',
          'POST /orders/:id/ship': 'Ship order with tracking',
          'POST /orders/:id/deliver': 'Confirm delivery',
          'GET /orders/:id/tracking': 'Get tracking info',
          'GET /orders/:id/timeline': 'Get order timeline',
        },
        dispute: {
          'POST /escrows/:id/dispute': 'Open dispute',
          'GET /disputes/:id': 'Get dispute details',
          'POST /disputes/:id/evidence': 'Add evidence',
          'POST /disputes/:id/respond': 'Seller response',
          'POST /disputes/:id/resolve': 'Resolve dispute (arbiter)',
          'POST /disputes/:id/escalate': 'Escalate dispute',
          'GET /disputes/:id/timeline': 'Get dispute timeline',
        },
      },
      headers: {
        'X-User-ID': 'User identifier',
        'X-User-Role': 'User role (buyer, seller, arbiter)',
      },
      workflow: [
        '1. POST /escrows - Create escrow with buyer, seller, amount',
        '2. POST /escrows/:id/fund - Buyer funds the escrow',
        '3. POST /escrows/:id/deliver - Seller marks as shipped',
        '4. POST /escrows/:id/confirm - Buyer confirms receipt OR',
        '4b. POST /escrows/:id/dispute - Buyer opens dispute',
        '5. POST /disputes/:id/resolve - Arbiter resolves if disputed',
      ],
      example: {
        method: 'POST',
        path: '/escrows',
        body: {
          buyer: 'buyer_alice',
          seller: 'seller_bob',
          amount: 500.0,
          currency: 'USD',
          itemDescription: 'Vintage Watch - 1960s Omega Seamaster',
        },
      },
    })
  })

  // ==========================================================================
  // ESCROW ENDPOINTS
  // ==========================================================================

  /**
   * POST /escrows - Create a new escrow
   */
  app.post('/escrows', async (c) => {
    try {
      const body = await c.req.json<CreateEscrowRequest>()

      if (!body.buyer || !body.seller || !body.amount || !body.itemDescription) {
        return c.json(
          { error: 'buyer, seller, amount, and itemDescription are required' },
          400
        )
      }

      // Create escrow with unique ID
      const escrowId = `esc_${crypto.randomUUID().slice(0, 12)}`
      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow>(stub, 'createEscrow', [body])

      return c.json(
        {
          success: true,
          message: 'Escrow created. Awaiting buyer funding.',
          escrow,
          nextStep: `POST /escrows/${escrow.id}/fund`,
        },
        201
      )
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * GET /escrows/:id - Get escrow details
   */
  app.get('/escrows/:id', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow | null>(stub, 'getEscrow', [])

      if (!escrow) {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      return c.json(escrow)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /escrows/:id/fund - Fund the escrow (buyer)
   */
  app.post('/escrows/:id/fund', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const body = await c.req.json<FundEscrowRequest>()

      if (!body.paymentMethod?.type || !body.paymentMethod?.token) {
        return c.json({ error: 'paymentMethod with type and token required' }, 400)
      }

      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow>(stub, 'fundEscrow', [body])

      return c.json({
        success: true,
        message: 'Escrow funded. Awaiting seller delivery.',
        escrow,
        deliveryDeadline: escrow.deliveryDeadline,
        nextStep: `POST /escrows/${escrow.id}/deliver`,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /escrows/:id/deliver - Mark as delivered (seller)
   */
  app.post('/escrows/:id/deliver', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const body = await c.req.json<DeliverRequest>()

      if (!body.trackingNumber || !body.carrier) {
        return c.json({ error: 'trackingNumber and carrier required' }, 400)
      }

      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow>(stub, 'markDelivered', [body])

      return c.json({
        success: true,
        message: `Marked as delivered. Buyer has until ${escrow.inspectionDeadline} to confirm or dispute.`,
        escrow,
        inspectionDeadline: escrow.inspectionDeadline,
        tracking: escrow.tracking,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /escrows/:id/confirm - Confirm receipt and release funds (buyer)
   */
  app.post('/escrows/:id/confirm', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const body = await c.req.json<{ rating?: number }>().catch(() => ({} as { rating?: number }))

      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow>(stub, 'confirmReceipt', [body?.rating])

      // Calculate fees
      const fees = await callDO<FeeDistribution>(stub, 'calculateFees', [escrow.amount])

      return c.json({
        success: true,
        message: 'Receipt confirmed. Funds released to seller.',
        escrow,
        distribution: fees,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /escrows/:id/cancel - Cancel escrow
   */
  app.post('/escrows/:id/cancel', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const body = await c.req.json<{ reason: string }>()
      const identity = getIdentity(c)

      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow>(stub, 'cancelEscrow', [identity.userId, body.reason])

      return c.json({
        success: true,
        message: 'Escrow cancelled.',
        escrow,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * GET /escrows/:id/timeline - Get escrow event history
   */
  app.get('/escrows/:id/timeline', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow | null>(stub, 'getEscrow', [])

      if (!escrow) {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      return c.json({
        escrowId: escrow.id,
        status: escrow.status,
        timeline: escrow.timeline,
      })
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * GET /escrows/:id/fees - Calculate fee distribution
   */
  app.get('/escrows/:id/fees', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const stub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow | null>(stub, 'getEscrow', [])

      if (!escrow) {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      const fees = await callDO<FeeDistribution>(stub, 'calculateFees', [escrow.amount])

      return c.json({
        escrowId: escrow.id,
        amount: escrow.amount,
        currency: escrow.currency,
        fees,
      })
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  // ==========================================================================
  // DISPUTE ENDPOINTS
  // ==========================================================================

  /**
   * POST /escrows/:id/dispute - Open a dispute
   */
  app.post('/escrows/:id/dispute', async (c) => {
    try {
      const escrowId = c.req.param('id')
      const body = await c.req.json<DisputeRequest & { openedBy?: 'buyer' | 'seller' }>()
      const identity = getIdentity(c)

      if (!body.reason || !body.description) {
        return c.json({ error: 'reason and description required' }, 400)
      }

      // Get escrow details first
      const escrowStub = c.env.ESCROW.get(c.env.ESCROW.idFromName(escrowId))
      const escrow = await callDO<Escrow | null>(escrowStub, 'getEscrow', [])

      if (!escrow) {
        return c.json({ error: 'Escrow not found' }, 404)
      }

      // Create dispute
      const disputeId = `dsp_${crypto.randomUUID().slice(0, 12)}`
      const disputeStub = c.env.DISPUTE.get(c.env.DISPUTE.idFromName(disputeId))

      const dispute = await callDO<Dispute>(disputeStub, 'openDispute', [
        {
          escrowId,
          buyer: escrow.buyer,
          seller: escrow.seller,
          arbiter: escrow.arbiter,
          amount: escrow.amount,
          reason: body.reason,
          description: body.description,
          openedBy: body.openedBy ?? identity.role === 'seller' ? 'seller' : 'buyer',
          evidence: body.evidence,
        },
      ])

      // Mark escrow as disputed
      await callDO(escrowStub, 'markDisputed', [
        disputeId,
        body.openedBy ?? 'buyer',
        body.reason,
      ])

      return c.json({
        success: true,
        message: 'Dispute opened. Arbiter will review within 7 days.',
        dispute,
        evidenceDeadline: dispute.evidenceDeadline,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * GET /disputes/:id - Get dispute details
   */
  app.get('/disputes/:id', async (c) => {
    try {
      const disputeId = c.req.param('id')
      const stub = c.env.DISPUTE.get(c.env.DISPUTE.idFromName(disputeId))
      const dispute = await callDO<Dispute | null>(stub, 'getDispute', [])

      if (!dispute) {
        return c.json({ error: 'Dispute not found' }, 404)
      }

      return c.json(dispute)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /disputes/:id/evidence - Add evidence to dispute
   */
  app.post('/disputes/:id/evidence', async (c) => {
    try {
      const disputeId = c.req.param('id')
      const body = await c.req.json<{
        type: 'photo' | 'video' | 'document' | 'message' | 'tracking' | 'screenshot'
        url: string
        description: string
        submittedBy: 'buyer' | 'seller'
      }>()
      const identity = getIdentity(c)

      if (!body.type || !body.url || !body.description) {
        return c.json({ error: 'type, url, and description required' }, 400)
      }

      const stub = c.env.DISPUTE.get(c.env.DISPUTE.idFromName(disputeId))
      const dispute = await callDO<Dispute>(stub, 'addEvidence', [
        {
          type: body.type,
          url: body.url,
          description: body.description,
          submittedBy: body.submittedBy ?? identity.role === 'seller' ? 'seller' : 'buyer',
        },
      ])

      return c.json({
        success: true,
        message: 'Evidence added.',
        dispute,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /disputes/:id/respond - Seller response to dispute
   */
  app.post('/disputes/:id/respond', async (c) => {
    try {
      const disputeId = c.req.param('id')
      const body = await c.req.json<{ response: string }>()

      if (!body.response) {
        return c.json({ error: 'response required' }, 400)
      }

      const stub = c.env.DISPUTE.get(c.env.DISPUTE.idFromName(disputeId))
      const dispute = await callDO<Dispute>(stub, 'submitSellerResponse', [body.response])

      return c.json({
        success: true,
        message: 'Response submitted.',
        dispute,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /disputes/:id/resolve - Resolve dispute (arbiter only)
   */
  app.post('/disputes/:id/resolve', async (c) => {
    try {
      const disputeId = c.req.param('id')
      const body = await c.req.json<ResolveRequest>()
      const identity = getIdentity(c)

      if (!body.decision || body.buyerAmount === undefined || body.sellerAmount === undefined) {
        return c.json({ error: 'decision, buyerAmount, and sellerAmount required' }, 400)
      }

      // Get dispute to get escrow ID
      const disputeStub = c.env.DISPUTE.get(c.env.DISPUTE.idFromName(disputeId))
      const dispute = await callDO<Dispute>(disputeStub, 'resolveDispute', [
        {
          decision: body.decision,
          buyerAmount: body.buyerAmount,
          sellerAmount: body.sellerAmount,
          notes: body.notes ?? '',
          resolvedBy: identity.userId,
        },
      ])

      // Update escrow with resolution
      const escrowStub = c.env.ESCROW.get(c.env.ESCROW.idFromName(dispute.escrowId))
      await callDO(escrowStub, 'markResolved', [
        disputeId,
        body.decision,
        body.buyerAmount,
        body.sellerAmount,
        body.notes ?? '',
      ])

      return c.json({
        success: true,
        message: 'Dispute resolved. Funds distributed.',
        dispute,
        resolution: dispute.resolution,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * POST /disputes/:id/escalate - Escalate dispute
   */
  app.post('/disputes/:id/escalate', async (c) => {
    try {
      const disputeId = c.req.param('id')
      const body = await c.req.json<{ reason: string }>()

      if (!body.reason) {
        return c.json({ error: 'reason required' }, 400)
      }

      const stub = c.env.DISPUTE.get(c.env.DISPUTE.idFromName(disputeId))
      const dispute = await callDO<Dispute>(stub, 'escalate', [body.reason])

      return c.json({
        success: true,
        message: 'Dispute escalated to senior arbiter.',
        dispute,
      })
    } catch (error) {
      if (error instanceof APIError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode)
      }
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * GET /disputes/:id/timeline - Get dispute timeline
   */
  app.get('/disputes/:id/timeline', async (c) => {
    try {
      const disputeId = c.req.param('id')
      const stub = c.env.DISPUTE.get(c.env.DISPUTE.idFromName(disputeId))
      const timeline = await callDO<Array<{ event: string; timestamp: string }>>(
        stub,
        'getTimeline',
        []
      )

      return c.json({
        disputeId,
        timeline,
      })
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  // ==========================================================================
  // ORDER ENDPOINTS
  // ==========================================================================

  /**
   * GET /orders/:id - Get order details
   */
  app.get('/orders/:id', async (c) => {
    try {
      const orderId = c.req.param('id')
      const stub = c.env.ORDER.get(c.env.ORDER.idFromName(orderId))
      const order = await callDO<Order | null>(stub, 'getOrder', [])

      if (!order) {
        return c.json({ error: 'Order not found' }, 404)
      }

      return c.json(order)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  /**
   * GET /orders/:id/tracking - Get order tracking info
   */
  app.get('/orders/:id/tracking', async (c) => {
    try {
      const orderId = c.req.param('id')
      const stub = c.env.ORDER.get(c.env.ORDER.idFromName(orderId))
      const tracking = await callDO<{
        tracking: { carrier: string; trackingNumber: string } | null
        status: string
      } | null>(stub, 'getTracking', [])

      if (!tracking) {
        return c.json({ error: 'Order not found' }, 404)
      }

      return c.json(tracking)
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400)
    }
  })

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // ==========================================================================
  // ERROR HANDLER
  // ==========================================================================

  app.onError((err, c) => {
    console.error('Error:', err)

    if (err instanceof APIError) {
      return c.json({ error: err.message, code: err.code, details: err.details }, err.statusCode)
    }

    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}

export default createAPI()
