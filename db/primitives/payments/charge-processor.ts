/**
 * ChargeProcessor - Charge processing with idempotency support
 *
 * Provides a focused charge processing primitive with:
 * - create() - Create charge with idempotency key
 * - capture() - Capture authorized charge
 * - refund() - Full or partial refund
 * - get() - Get charge details
 * - list() - List customer charges
 *
 * ## Idempotency
 * - Idempotency key storage with automatic lookup
 * - Returns cached result for duplicate requests
 * - Keys expire after 24 hours
 *
 * ## Status Management
 * - Status transitions: pending -> succeeded -> partially_refunded -> refunded
 * - Event emission for status changes
 * - Webhook integration points
 *
 * @module db/primitives/payments/charge-processor
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Charge status
 */
export type ChargeStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'

/**
 * Refund record
 */
export interface ChargeRefund {
  id: string
  chargeId: string
  amount: number
  status: 'pending' | 'succeeded' | 'failed'
  createdAt: Date
}

/**
 * Charge record
 */
export interface Charge {
  id: string
  amount: number
  currency: string
  status: ChargeStatus
  customerId: string
  paymentMethodId: string
  description?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  capturedAt?: Date
  capturedAmount?: number
  refundedAmount?: number
  refunds?: ChargeRefund[]
}

/**
 * Create charge parameters
 */
export interface CreateChargeParams {
  amount: number
  currency: string
  customerId: string
  paymentMethodId: string
  description?: string
  metadata?: Record<string, unknown>
  idempotencyKey?: string
  /** Whether to capture immediately. Default: false (authorize only) */
  capture?: boolean
}

/**
 * Refund result
 */
export interface RefundResult {
  refundId: string
  amount: number
  status: 'succeeded' | 'failed'
}

/**
 * Charge event types
 */
export type ChargeEventType =
  | 'charge.created'
  | 'charge.captured'
  | 'charge.succeeded'
  | 'charge.failed'
  | 'charge.refunded'
  | 'charge.updated'

/**
 * Charge event payload
 */
export interface ChargeEvent {
  type: ChargeEventType
  charge?: Charge
  data?: Record<string, unknown>
}

/**
 * Webhook event payload
 */
export interface WebhookEvent {
  type: string
  data: Record<string, unknown>
}

/**
 * Charge event handler
 */
export type ChargeEventHandler = (event: ChargeEvent | WebhookEvent) => void | Promise<void>

/**
 * Unsubscribe function
 */
export type Unsubscribe = () => void

/**
 * ChargeProcessor interface
 */
export interface ChargeProcessor {
  /**
   * Create a new charge
   * @param params - Charge parameters
   * @returns Created charge
   */
  create(params: CreateChargeParams): Promise<Charge>

  /**
   * Capture an authorized charge
   * @param chargeId - ID of the charge to capture
   * @param amount - Amount to capture (optional, defaults to full amount)
   * @returns Updated charge
   */
  capture(chargeId: string, amount?: number): Promise<Charge>

  /**
   * Refund a captured charge
   * @param chargeId - ID of the charge to refund
   * @param amount - Amount to refund (optional, defaults to full remaining amount)
   * @returns Refund result
   */
  refund(chargeId: string, amount?: number): Promise<RefundResult>

  /**
   * Get charge details
   * @param chargeId - ID of the charge
   * @returns Charge or null if not found
   */
  get(chargeId: string): Promise<Charge | null>

  /**
   * List charges for a customer
   * @param customerId - Customer ID
   * @returns List of charges
   */
  list(customerId: string): Promise<Charge[]>

  /**
   * Subscribe to charge events
   * @param event - Event type to subscribe to
   * @param handler - Event handler
   * @returns Unsubscribe function
   */
  on(event: ChargeEventType | string, handler: ChargeEventHandler): Unsubscribe

  /**
   * Get all handlers for an event type
   * @param event - Event type
   * @returns Array of handlers
   */
  getEventHandlers(event: string): ChargeEventHandler[]

  /**
   * Process an external webhook event
   * @param event - Webhook event
   */
  processWebhook(event: WebhookEvent): Promise<void>
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique ID with prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

// =============================================================================
// Idempotency Cache Entry
// =============================================================================

interface IdempotencyCacheEntry {
  charge: Charge
  expiresAt: number
}

// =============================================================================
// Implementation
// =============================================================================

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

class ChargeProcessorImpl implements ChargeProcessor {
  private charges: Map<string, Charge> = new Map()
  private idempotencyCache: Map<string, IdempotencyCacheEntry> = new Map()
  private eventHandlers: Map<string, ChargeEventHandler[]> = new Map()

  // =============================================================================
  // Create
  // =============================================================================

  async create(params: CreateChargeParams): Promise<Charge> {
    // Validate amount
    if (params.amount <= 0) {
      throw new Error('Amount must be positive')
    }

    // Check idempotency
    if (params.idempotencyKey) {
      const cached = this.idempotencyCache.get(params.idempotencyKey)
      if (cached && Date.now() < cached.expiresAt) {
        return cached.charge
      }
      // Remove expired entry if exists
      if (cached) {
        this.idempotencyCache.delete(params.idempotencyKey)
      }
    }

    const now = new Date()
    const charge: Charge = {
      id: generateId('ch'),
      amount: params.amount,
      currency: params.currency,
      status: 'pending',
      customerId: params.customerId,
      paymentMethodId: params.paymentMethodId,
      description: params.description,
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
      refundedAmount: 0,
      refunds: [],
    }

    // Handle immediate capture
    if (params.capture) {
      charge.status = 'succeeded'
      charge.capturedAt = now
      charge.capturedAmount = params.amount
    }

    // Store charge
    this.charges.set(charge.id, charge)

    // Store idempotency key
    if (params.idempotencyKey) {
      this.idempotencyCache.set(params.idempotencyKey, {
        charge,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      })
    }

    // Emit events
    this.emit('charge.created', { type: 'charge.created', charge })

    if (params.capture) {
      this.emit('charge.succeeded', { type: 'charge.succeeded', charge })
    }

    return charge
  }

  // =============================================================================
  // Capture
  // =============================================================================

  async capture(chargeId: string, amount?: number): Promise<Charge> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    if (charge.status === 'succeeded') {
      throw new Error('Charge already captured')
    }

    if (charge.status === 'failed') {
      throw new Error('Cannot capture failed charge')
    }

    const captureAmount = amount ?? charge.amount

    if (captureAmount > charge.amount) {
      throw new Error('Cannot capture more than authorized amount')
    }

    // Update charge
    charge.status = 'succeeded'
    charge.capturedAt = new Date()
    charge.capturedAmount = captureAmount
    charge.updatedAt = new Date()

    // Emit event
    this.emit('charge.captured', { type: 'charge.captured', charge })

    return charge
  }

  // =============================================================================
  // Refund
  // =============================================================================

  async refund(chargeId: string, amount?: number): Promise<RefundResult> {
    const charge = this.charges.get(chargeId)
    if (!charge) {
      throw new Error('Charge not found')
    }

    if (charge.status === 'pending' || charge.status === 'failed') {
      throw new Error('Cannot refund uncaptured charge')
    }

    if (charge.status === 'refunded') {
      throw new Error('Charge already fully refunded')
    }

    const refundedSoFar = charge.refundedAmount ?? 0
    const availableForRefund = charge.amount - refundedSoFar
    const refundAmount = amount ?? availableForRefund

    if (refundAmount > availableForRefund) {
      throw new Error('Refund amount exceeds available amount')
    }

    // Create refund record
    const refund: ChargeRefund = {
      id: generateId('re'),
      chargeId: charge.id,
      amount: refundAmount,
      status: 'succeeded',
      createdAt: new Date(),
    }

    // Update charge
    charge.refundedAmount = refundedSoFar + refundAmount
    charge.refunds = [...(charge.refunds ?? []), refund]
    charge.status = charge.refundedAmount >= charge.amount ? 'refunded' : 'partially_refunded'
    charge.updatedAt = new Date()

    // Emit event
    this.emit('charge.refunded', { type: 'charge.refunded', charge })

    return {
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
    }
  }

  // =============================================================================
  // Get
  // =============================================================================

  async get(chargeId: string): Promise<Charge | null> {
    return this.charges.get(chargeId) ?? null
  }

  // =============================================================================
  // List
  // =============================================================================

  async list(customerId: string): Promise<Charge[]> {
    const charges = Array.from(this.charges.values())
      .filter((c) => c.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return charges
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  on(event: ChargeEventType | string, handler: ChargeEventHandler): Unsubscribe {
    let handlers = this.eventHandlers.get(event)
    if (!handlers) {
      handlers = []
      this.eventHandlers.set(event, handlers)
    }
    handlers.push(handler)

    // Return unsubscribe function
    return () => {
      const currentHandlers = this.eventHandlers.get(event)
      if (currentHandlers) {
        const index = currentHandlers.indexOf(handler)
        if (index !== -1) {
          currentHandlers.splice(index, 1)
        }
      }
    }
  }

  getEventHandlers(event: string): ChargeEventHandler[] {
    return this.eventHandlers.get(event) ?? []
  }

  async processWebhook(event: WebhookEvent): Promise<void> {
    const handlers = this.eventHandlers.get(event.type) ?? []
    for (const handler of handlers) {
      await handler(event)
    }
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private emit(event: string, payload: ChargeEvent): void {
    const handlers = this.eventHandlers.get(event) ?? []
    for (const handler of handlers) {
      try {
        handler(payload)
      } catch (e) {
        // Ignore handler errors
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ChargeProcessor instance
 */
export function createChargeProcessor(): ChargeProcessor {
  return new ChargeProcessorImpl()
}
