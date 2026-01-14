/**
 * Stripe PaymentIntents Resource - Local Implementation
 *
 * Uses ExactlyOnceContext for idempotent payment operations.
 * Prevents duplicate charges and ensures payment consistency.
 */

import { ExactlyOnceContext, type ExactlyOnceContextInterface } from '../../../db/primitives/exactly-once-context'
import type {
  PaymentIntent,
  PaymentIntentStatus,
  PaymentIntentCancellationReason,
  PaymentIntentCreateParams,
  PaymentIntentUpdateParams,
  PaymentIntentConfirmParams,
  PaymentIntentCaptureParams,
  PaymentIntentCancelParams,
  PaymentIntentListParams,
  Charge,
  ChargeCreateParams,
  ChargeUpdateParams,
  ChargeCaptureParams,
  ChargeListParams,
  Refund,
  RefundCreateParams,
  RefundUpdateParams,
  RefundListParams,
  ListResponse,
  Metadata,
} from '../types'

export interface PaymentsResourceOptions {
  onEvent?: (type: string, data: unknown) => void
}

/**
 * Local PaymentIntents Resource
 * Uses ExactlyOnceContext for idempotent operations
 */
export class LocalPaymentIntentsResource {
  private paymentIntents: Map<string, PaymentIntent> = new Map()
  private idempotencyKeys: Map<string, string> = new Map() // idempotency_key -> payment_intent_id
  private exactlyOnce: ExactlyOnceContextInterface
  private onEvent?: (type: string, data: unknown) => void

  constructor(options?: PaymentsResourceOptions) {
    this.exactlyOnce = new ExactlyOnceContext({
      eventIdTtl: 24 * 60 * 60 * 1000, // 24 hours TTL for idempotency
      onDeliver: async (events) => {
        // Flush webhook events
        for (const event of events) {
          const e = event as { type: string; data: unknown }
          if (this.onEvent) {
            this.onEvent(e.type, e.data)
          }
        }
      },
    })
    this.onEvent = options?.onEvent
  }

  private generateId(): string {
    return `pi_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  private generateClientSecret(id: string): string {
    return `${id}_secret_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  /**
   * Create a payment intent with idempotency support
   */
  async create(
    params: PaymentIntentCreateParams,
    options?: { idempotencyKey?: string }
  ): Promise<PaymentIntent> {
    // Check idempotency
    if (options?.idempotencyKey) {
      const existingId = this.idempotencyKeys.get(options.idempotencyKey)
      if (existingId) {
        const existing = this.paymentIntents.get(existingId)
        if (existing) return existing
      }
    }

    const eventId = options?.idempotencyKey ?? `create_${Date.now()}_${Math.random()}`

    return this.exactlyOnce.processOnce(eventId, async () => {
      const now = Math.floor(Date.now() / 1000)
      const id = this.generateId()

      // Determine initial status
      let status: PaymentIntentStatus = 'requires_payment_method'
      if (params.payment_method) {
        status = 'requires_confirmation'
      }

      const paymentIntent: PaymentIntent = {
        id,
        object: 'payment_intent',
        amount: params.amount,
        amount_capturable: 0,
        amount_details: undefined,
        amount_received: 0,
        application: null,
        application_fee_amount: null,
        automatic_payment_methods: params.automatic_payment_methods ?? null,
        canceled_at: null,
        cancellation_reason: null,
        capture_method: params.capture_method ?? 'automatic',
        client_secret: this.generateClientSecret(id),
        confirmation_method: params.confirmation_method ?? 'automatic',
        created: now,
        currency: params.currency.toLowerCase(),
        customer: params.customer ?? null,
        description: params.description ?? null,
        invoice: null,
        last_payment_error: null,
        latest_charge: null,
        livemode: false,
        metadata: params.metadata ?? {},
        next_action: null,
        on_behalf_of: null,
        payment_method: params.payment_method ?? null,
        payment_method_configuration_details: null,
        payment_method_options: params.payment_method_options ?? null,
        payment_method_types: params.payment_method_types ?? ['card'],
        processing: null,
        receipt_email: params.receipt_email ?? null,
        review: null,
        setup_future_usage: params.setup_future_usage ?? null,
        shipping: params.shipping ?? null,
        statement_descriptor: params.statement_descriptor ?? null,
        statement_descriptor_suffix: params.statement_descriptor_suffix ?? null,
        status,
        transfer_data: params.transfer_data ?? null,
        transfer_group: params.transfer_group ?? null,
      }

      this.paymentIntents.set(id, paymentIntent)

      // Store idempotency key mapping
      if (options?.idempotencyKey) {
        this.idempotencyKeys.set(options.idempotencyKey, id)
      }

      // Auto-confirm if requested
      if (params.confirm && params.payment_method) {
        return this.confirmInternal(id, {})
      }

      this.emitEvent('payment_intent.created', paymentIntent)
      return paymentIntent
    })
  }

  /**
   * Retrieve a payment intent
   */
  async retrieve(id: string): Promise<PaymentIntent> {
    const pi = this.paymentIntents.get(id)
    if (!pi) {
      throw this.createError('resource_missing', `No such payment_intent: '${id}'`, 'id')
    }
    return pi
  }

  /**
   * Update a payment intent
   */
  async update(id: string, params: PaymentIntentUpdateParams): Promise<PaymentIntent> {
    const existing = await this.retrieve(id)

    if (['succeeded', 'canceled'].includes(existing.status)) {
      throw this.createError(
        'invalid_request',
        'Cannot update a PaymentIntent that has already succeeded or been canceled',
        'id'
      )
    }

    const updated: PaymentIntent = {
      ...existing,
      amount: params.amount ?? existing.amount,
      currency: params.currency?.toLowerCase() ?? existing.currency,
      customer: params.customer ?? existing.customer,
      description: params.description === '' ? null : (params.description ?? existing.description),
      metadata: params.metadata === '' ? {} : (params.metadata ?? existing.metadata),
      payment_method: params.payment_method ?? existing.payment_method,
      payment_method_options: params.payment_method_options ?? existing.payment_method_options,
      payment_method_types: params.payment_method_types ?? existing.payment_method_types,
      receipt_email: params.receipt_email === '' ? null : (params.receipt_email ?? existing.receipt_email),
      setup_future_usage: params.setup_future_usage === '' ? null : (params.setup_future_usage ?? existing.setup_future_usage),
      shipping: params.shipping === '' ? null : (params.shipping ?? existing.shipping),
      statement_descriptor: params.statement_descriptor ?? existing.statement_descriptor,
      statement_descriptor_suffix: params.statement_descriptor_suffix ?? existing.statement_descriptor_suffix,
      transfer_data: params.transfer_data
        ? { ...existing.transfer_data, ...params.transfer_data } as typeof existing.transfer_data
        : existing.transfer_data,
      transfer_group: params.transfer_group ?? existing.transfer_group,
    }

    // Update status if payment method was added
    if (params.payment_method && existing.status === 'requires_payment_method') {
      updated.status = 'requires_confirmation'
    }

    this.paymentIntents.set(id, updated)
    return updated
  }

  /**
   * Confirm a payment intent
   */
  async confirm(
    id: string,
    params?: PaymentIntentConfirmParams,
    options?: { idempotencyKey?: string }
  ): Promise<PaymentIntent> {
    const eventId = options?.idempotencyKey ?? `confirm_${id}_${Date.now()}`

    return this.exactlyOnce.processOnce(eventId, async () => {
      return this.confirmInternal(id, params ?? {})
    })
  }

  private async confirmInternal(id: string, params: PaymentIntentConfirmParams): Promise<PaymentIntent> {
    const existing = await this.retrieve(id)

    if (!['requires_confirmation', 'requires_payment_method'].includes(existing.status)) {
      throw this.createError(
        'invalid_request',
        `PaymentIntent status (${existing.status}) does not allow confirmation`,
        'id'
      )
    }

    const paymentMethod = params.payment_method ?? existing.payment_method
    if (!paymentMethod && existing.status === 'requires_payment_method') {
      throw this.createError('parameter_missing', 'You must provide a payment method', 'payment_method')
    }

    // Simulate payment processing
    const now = Math.floor(Date.now() / 1000)
    const chargeId = `ch_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`

    // For manual capture, set to requires_capture
    const captureMethod = params.capture_method ?? existing.capture_method
    let status: PaymentIntentStatus = 'succeeded'
    let amountReceived = existing.amount
    let amountCapturable = 0

    if (captureMethod === 'manual') {
      status = 'requires_capture'
      amountReceived = 0
      amountCapturable = existing.amount
    }

    const updated: PaymentIntent = {
      ...existing,
      payment_method: paymentMethod,
      status,
      amount_received: amountReceived,
      amount_capturable: amountCapturable,
      latest_charge: chargeId,
      capture_method: captureMethod,
    }

    if (params.receipt_email) {
      updated.receipt_email = params.receipt_email
    }
    if (params.shipping) {
      updated.shipping = params.shipping
    }
    if (params.setup_future_usage !== undefined) {
      updated.setup_future_usage = params.setup_future_usage === '' ? null : params.setup_future_usage
    }

    this.paymentIntents.set(id, updated)
    this.emitEvent('payment_intent.succeeded', updated)
    return updated
  }

  /**
   * Capture a payment intent (for manual capture)
   */
  async capture(
    id: string,
    params?: PaymentIntentCaptureParams,
    options?: { idempotencyKey?: string }
  ): Promise<PaymentIntent> {
    const eventId = options?.idempotencyKey ?? `capture_${id}_${Date.now()}`

    return this.exactlyOnce.processOnce(eventId, async () => {
      const existing = await this.retrieve(id)

      if (existing.status !== 'requires_capture') {
        throw this.createError(
          'invalid_request',
          `PaymentIntent status (${existing.status}) does not allow capture`,
          'id'
        )
      }

      const amountToCapture = params?.amount_to_capture ?? existing.amount_capturable
      if (amountToCapture > existing.amount_capturable) {
        throw this.createError(
          'invalid_request',
          `Amount to capture (${amountToCapture}) exceeds capturable amount (${existing.amount_capturable})`,
          'amount_to_capture'
        )
      }

      const updated: PaymentIntent = {
        ...existing,
        status: 'succeeded',
        amount_received: amountToCapture,
        amount_capturable: 0,
        metadata: params?.metadata ? { ...existing.metadata, ...params.metadata } : existing.metadata,
        statement_descriptor: params?.statement_descriptor ?? existing.statement_descriptor,
        statement_descriptor_suffix: params?.statement_descriptor_suffix ?? existing.statement_descriptor_suffix,
      }

      this.paymentIntents.set(id, updated)
      this.emitEvent('payment_intent.amount_capturable_updated', updated)
      return updated
    })
  }

  /**
   * Cancel a payment intent
   */
  async cancel(
    id: string,
    params?: PaymentIntentCancelParams,
    options?: { idempotencyKey?: string }
  ): Promise<PaymentIntent> {
    const eventId = options?.idempotencyKey ?? `cancel_${id}_${Date.now()}`

    return this.exactlyOnce.processOnce(eventId, async () => {
      const existing = await this.retrieve(id)

      if (['succeeded', 'canceled'].includes(existing.status)) {
        throw this.createError(
          'invalid_request',
          `PaymentIntent status (${existing.status}) does not allow cancellation`,
          'id'
        )
      }

      const now = Math.floor(Date.now() / 1000)
      const updated: PaymentIntent = {
        ...existing,
        status: 'canceled',
        canceled_at: now,
        cancellation_reason: params?.cancellation_reason ?? null,
      }

      this.paymentIntents.set(id, updated)
      this.emitEvent('payment_intent.canceled', updated)
      return updated
    })
  }

  /**
   * List payment intents
   */
  async list(params?: PaymentIntentListParams): Promise<ListResponse<PaymentIntent>> {
    const limit = Math.min(params?.limit ?? 10, 100)
    let paymentIntents = Array.from(this.paymentIntents.values())

    // Apply filters
    if (params?.customer) {
      paymentIntents = paymentIntents.filter((pi) => pi.customer === params.customer)
    }
    if (params?.created) {
      paymentIntents = paymentIntents.filter((pi) => {
        if (params.created!.gt !== undefined && pi.created <= params.created!.gt) return false
        if (params.created!.gte !== undefined && pi.created < params.created!.gte) return false
        if (params.created!.lt !== undefined && pi.created >= params.created!.lt) return false
        if (params.created!.lte !== undefined && pi.created > params.created!.lte) return false
        return true
      })
    }

    // Sort by created descending
    paymentIntents.sort((a, b) => b.created - a.created)

    // Cursor pagination
    let startIndex = 0
    if (params?.starting_after) {
      const idx = paymentIntents.findIndex((pi) => pi.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = paymentIntents.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < paymentIntents.length,
      url: '/v1/payment_intents',
    }
  }

  /**
   * Search payment intents
   */
  async search(params: {
    query: string
    limit?: number
    page?: string
  }): Promise<{ data: PaymentIntent[]; has_more: boolean; next_page?: string }> {
    const limit = Math.min(params.limit ?? 10, 100)
    let paymentIntents = Array.from(this.paymentIntents.values())

    // Simple query parsing
    const customerMatch = params.query.match(/customer:"([^"]+)"/)
    const statusMatch = params.query.match(/status:"([^"]+)"/)
    const amountMatch = params.query.match(/amount[><=]+(\d+)/)

    paymentIntents = paymentIntents.filter((pi) => {
      if (customerMatch && pi.customer !== customerMatch[1]) return false
      if (statusMatch && pi.status !== statusMatch[1]) return false
      if (amountMatch) {
        const amount = parseInt(amountMatch[1])
        const op = params.query.match(/amount([><=]+)/)?.[1]
        if (op === '>' && pi.amount <= amount) return false
        if (op === '>=' && pi.amount < amount) return false
        if (op === '<' && pi.amount >= amount) return false
        if (op === '<=' && pi.amount > amount) return false
        if (op === '=' && pi.amount !== amount) return false
      }
      return true
    })

    const page = paymentIntents.slice(0, limit)

    return {
      data: page,
      has_more: paymentIntents.length > limit,
      next_page: paymentIntents.length > limit ? 'next' : undefined,
    }
  }

  /**
   * Increment authorization (for card present)
   */
  async incrementAuthorization(
    id: string,
    params: { amount: number; description?: string; metadata?: Metadata }
  ): Promise<PaymentIntent> {
    const existing = await this.retrieve(id)

    if (existing.status !== 'requires_capture') {
      throw this.createError(
        'invalid_request',
        'Can only increment authorization on PaymentIntents with requires_capture status',
        'id'
      )
    }

    const updated: PaymentIntent = {
      ...existing,
      amount: existing.amount + params.amount,
      amount_capturable: existing.amount_capturable + params.amount,
      description: params.description ?? existing.description,
      metadata: params.metadata ? { ...existing.metadata, ...params.metadata } : existing.metadata,
    }

    this.paymentIntents.set(id, updated)
    return updated
  }

  /**
   * Flush pending events
   */
  async flush(): Promise<void> {
    await this.exactlyOnce.flush()
  }

  /**
   * Clear all state (for testing)
   */
  async clear(): Promise<void> {
    this.paymentIntents.clear()
    this.idempotencyKeys.clear()
    await this.exactlyOnce.clear()
  }

  private emitEvent(type: string, data: unknown): void {
    // Emit directly to the onEvent handler (not via ExactlyOnceContext buffer)
    // ExactlyOnceContext is used for idempotency of operations, not event buffering
    if (this.onEvent) {
      this.onEvent(type, data)
    }
  }

  private createError(code: string, message: string, param?: string): Error {
    const error = new Error(message) as Error & { type: string; code: string; param?: string }
    error.type = 'invalid_request_error'
    error.code = code
    error.param = param
    return error
  }
}

/**
 * Local Charges Resource (Legacy API)
 */
export class LocalChargesResource {
  private charges: Map<string, Charge> = new Map()
  private paymentIntentsResource: LocalPaymentIntentsResource
  private onEvent?: (type: string, data: unknown) => void

  constructor(
    paymentIntentsResource: LocalPaymentIntentsResource,
    options?: { onEvent?: (type: string, data: unknown) => void }
  ) {
    this.paymentIntentsResource = paymentIntentsResource
    this.onEvent = options?.onEvent
  }

  private generateId(): string {
    return `ch_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  /**
   * Create a charge (legacy - wraps PaymentIntent)
   * @deprecated Use PaymentIntents instead
   */
  async create(params: ChargeCreateParams): Promise<Charge> {
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId()

    const charge: Charge = {
      id,
      object: 'charge',
      amount: params.amount,
      amount_captured: params.capture !== false ? params.amount : 0,
      amount_refunded: 0,
      application: null,
      application_fee: null,
      application_fee_amount: null,
      balance_transaction: `txn_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`,
      billing_details: {
        address: null,
        email: params.receipt_email ?? null,
        name: null,
        phone: null,
      },
      calculated_statement_descriptor: params.statement_descriptor ?? null,
      captured: params.capture !== false,
      created: now,
      currency: params.currency.toLowerCase(),
      customer: params.customer ?? null,
      description: params.description ?? null,
      disputed: false,
      failure_balance_transaction: null,
      failure_code: null,
      failure_message: null,
      fraud_details: null,
      invoice: null,
      livemode: false,
      metadata: params.metadata ?? {},
      on_behalf_of: params.on_behalf_of ?? null,
      outcome: {
        network_status: 'approved_by_network',
        reason: null,
        risk_level: 'normal',
        risk_score: 30,
        seller_message: 'Payment complete.',
        type: 'authorized',
      },
      paid: true,
      payment_intent: null,
      payment_method: null,
      payment_method_details: {
        type: 'card',
        card: {
          brand: 'visa',
          checks: null,
          country: 'US',
          exp_month: 12,
          exp_year: 2030,
          fingerprint: 'test_fingerprint',
          funding: 'credit',
          last4: '4242',
          network: 'visa',
        },
      },
      receipt_email: params.receipt_email ?? null,
      receipt_number: null,
      receipt_url: `https://pay.stripe.com/receipts/${id}`,
      refunded: false,
      shipping: params.shipping ?? null,
      source: params.source ? { id: params.source, object: 'card' } : null,
      source_transfer: null,
      statement_descriptor: params.statement_descriptor ?? null,
      statement_descriptor_suffix: params.statement_descriptor_suffix ?? null,
      status: 'succeeded',
      transfer: null,
      transfer_data: params.transfer_data ?? null,
      transfer_group: params.transfer_group ?? null,
    }

    this.charges.set(id, charge)
    this.emitEvent('charge.succeeded', charge)
    return charge
  }

  async retrieve(id: string): Promise<Charge> {
    const charge = this.charges.get(id)
    if (!charge) {
      throw this.createError('resource_missing', `No such charge: '${id}'`, 'id')
    }
    return charge
  }

  async update(id: string, params: ChargeUpdateParams): Promise<Charge> {
    const existing = await this.retrieve(id)

    const updated: Charge = {
      ...existing,
      customer: params.customer ?? existing.customer,
      description: params.description ?? existing.description,
      metadata: params.metadata === '' ? {} : (params.metadata ?? existing.metadata),
      receipt_email: params.receipt_email ?? existing.receipt_email,
      shipping: params.shipping ?? existing.shipping,
      transfer_group: params.transfer_group ?? existing.transfer_group,
    }

    this.charges.set(id, updated)
    this.emitEvent('charge.updated', updated)
    return updated
  }

  async capture(id: string, params?: ChargeCaptureParams): Promise<Charge> {
    const existing = await this.retrieve(id)

    if (existing.captured) {
      throw this.createError('invalid_request', 'Charge has already been captured', 'id')
    }

    const amountToCapture = params?.amount ?? existing.amount
    const updated: Charge = {
      ...existing,
      captured: true,
      amount_captured: amountToCapture,
      receipt_email: params?.receipt_email ?? existing.receipt_email,
      statement_descriptor: params?.statement_descriptor ?? existing.statement_descriptor,
      statement_descriptor_suffix: params?.statement_descriptor_suffix ?? existing.statement_descriptor_suffix,
    }

    this.charges.set(id, updated)
    this.emitEvent('charge.captured', updated)
    return updated
  }

  async list(params?: ChargeListParams): Promise<ListResponse<Charge>> {
    const limit = Math.min(params?.limit ?? 10, 100)
    let charges = Array.from(this.charges.values())

    if (params?.customer) {
      charges = charges.filter((c) => c.customer === params.customer)
    }
    if (params?.payment_intent) {
      charges = charges.filter((c) => c.payment_intent === params.payment_intent)
    }
    if (params?.transfer_group) {
      charges = charges.filter((c) => c.transfer_group === params.transfer_group)
    }

    charges.sort((a, b) => b.created - a.created)

    let startIndex = 0
    if (params?.starting_after) {
      const idx = charges.findIndex((c) => c.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = charges.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < charges.length,
      url: '/v1/charges',
    }
  }

  private emitEvent(type: string, data: unknown): void {
    if (this.onEvent) this.onEvent(type, data)
  }

  private createError(code: string, message: string, param?: string): Error {
    const error = new Error(message) as Error & { type: string; code: string; param?: string }
    error.type = 'invalid_request_error'
    error.code = code
    error.param = param
    return error
  }
}

/**
 * Local Refunds Resource
 */
export class LocalRefundsResource {
  private refunds: Map<string, Refund> = new Map()
  private chargesResource: LocalChargesResource
  private paymentIntentsResource: LocalPaymentIntentsResource
  private onEvent?: (type: string, data: unknown) => void

  constructor(
    chargesResource: LocalChargesResource,
    paymentIntentsResource: LocalPaymentIntentsResource,
    options?: { onEvent?: (type: string, data: unknown) => void }
  ) {
    this.chargesResource = chargesResource
    this.paymentIntentsResource = paymentIntentsResource
    this.onEvent = options?.onEvent
  }

  private generateId(): string {
    return `re_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  async create(params: RefundCreateParams): Promise<Refund> {
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId()

    let chargeId: string | undefined
    let amount: number

    if (params.payment_intent) {
      const pi = await this.paymentIntentsResource.retrieve(params.payment_intent)
      chargeId = pi.latest_charge ?? undefined
      amount = params.amount ?? pi.amount_received
    } else if (params.charge) {
      const charge = await this.chargesResource.retrieve(params.charge)
      chargeId = charge.id
      amount = params.amount ?? charge.amount_captured - charge.amount_refunded
    } else {
      throw this.createError('parameter_missing', 'Must provide payment_intent or charge', 'payment_intent')
    }

    const refund: Refund = {
      id,
      object: 'refund',
      amount,
      balance_transaction: `txn_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`,
      charge: chargeId ?? null,
      created: now,
      currency: params.currency ?? 'usd',
      description: null,
      failure_balance_transaction: null,
      failure_reason: null,
      instructions_email: params.instructions_email ?? null,
      metadata: params.metadata ?? {},
      next_action: null,
      payment_intent: params.payment_intent ?? null,
      reason: params.reason ?? null,
      receipt_number: null,
      source_transfer_reversal: null,
      status: 'succeeded',
      transfer_reversal: null,
    }

    this.refunds.set(id, refund)
    this.emitEvent('charge.refunded', refund)
    return refund
  }

  async retrieve(id: string): Promise<Refund> {
    const refund = this.refunds.get(id)
    if (!refund) {
      throw this.createError('resource_missing', `No such refund: '${id}'`, 'id')
    }
    return refund
  }

  async update(id: string, params: RefundUpdateParams): Promise<Refund> {
    const existing = await this.retrieve(id)

    const updated: Refund = {
      ...existing,
      metadata: params.metadata === '' ? {} : (params.metadata ?? existing.metadata),
    }

    this.refunds.set(id, updated)
    return updated
  }

  async cancel(id: string): Promise<Refund> {
    const existing = await this.retrieve(id)

    if (existing.status !== 'pending' && existing.status !== 'requires_action') {
      throw this.createError('invalid_request', 'Only pending refunds can be canceled', 'id')
    }

    const updated: Refund = {
      ...existing,
      status: 'canceled',
    }

    this.refunds.set(id, updated)
    return updated
  }

  async list(params?: RefundListParams): Promise<ListResponse<Refund>> {
    const limit = Math.min(params?.limit ?? 10, 100)
    let refunds = Array.from(this.refunds.values())

    if (params?.charge) {
      refunds = refunds.filter((r) => r.charge === params.charge)
    }
    if (params?.payment_intent) {
      refunds = refunds.filter((r) => r.payment_intent === params.payment_intent)
    }

    refunds.sort((a, b) => b.created - a.created)

    let startIndex = 0
    if (params?.starting_after) {
      const idx = refunds.findIndex((r) => r.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = refunds.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < refunds.length,
      url: '/v1/refunds',
    }
  }

  private emitEvent(type: string, data: unknown): void {
    if (this.onEvent) this.onEvent(type, data)
  }

  private createError(code: string, message: string, param?: string): Error {
    const error = new Error(message) as Error & { type: string; code: string; param?: string }
    error.type = 'invalid_request_error'
    error.code = code
    error.param = param
    return error
  }
}
