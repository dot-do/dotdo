/**
 * payments.do - Durable Objects
 *
 * Durable Objects for managing payment state:
 * - CustomerDO: Customer records with multi-provider sync
 * - PaymentStateDO: Payment state machine
 * - WebhookLogDO: Webhook event log for idempotency
 */

/// <reference types="@cloudflare/workers-types" />

import type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  PaymentIntent,
  PaymentState,
  PaymentStateType,
  PaymentStateTransition,
  PaymentProvider,
  Subscription,
  SubscriptionStatus,
  WebhookEvent,
  WebhookEventLog,
  Metadata,
  Currency,
} from './types'

// =============================================================================
// CustomerDO - Customer Records with Multi-Provider Sync
// =============================================================================

export class CustomerDO implements DurableObject {
  private ctx: DurableObjectState
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx
    this.sql = ctx.storage.sql
    this.ensureTables()
  }

  private ensureTables(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        phone TEXT,
        address TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        provider_ids TEXT NOT NULL DEFAULT '{}',
        default_payment_method TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        currency TEXT,
        delinquent INTEGER NOT NULL DEFAULT 0,
        livemode INTEGER NOT NULL DEFAULT 0
      )
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)
    `)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      if (url.pathname === '/customer' || url.pathname === '/') {
        if (method === 'GET') {
          const id = url.searchParams.get('id')
          if (!id) {
            return this.errorResponse(400, 'Customer ID required')
          }
          const customer = await this.get(id)
          if (!customer) {
            return this.errorResponse(404, 'Customer not found')
          }
          return this.jsonResponse(customer)
        }

        if (method === 'POST') {
          const params = await request.json() as CustomerCreateParams
          const customer = await this.create(params)
          return this.jsonResponse(customer, 201)
        }

        if (method === 'PUT' || method === 'PATCH') {
          const id = url.searchParams.get('id')
          if (!id) {
            return this.errorResponse(400, 'Customer ID required')
          }
          const params = await request.json() as CustomerUpdateParams
          const customer = await this.update(id, params)
          if (!customer) {
            return this.errorResponse(404, 'Customer not found')
          }
          return this.jsonResponse(customer)
        }

        if (method === 'DELETE') {
          const id = url.searchParams.get('id')
          if (!id) {
            return this.errorResponse(400, 'Customer ID required')
          }
          const deleted = await this.delete(id)
          if (!deleted) {
            return this.errorResponse(404, 'Customer not found')
          }
          return this.jsonResponse({ deleted: true, id })
        }
      }

      if (url.pathname === '/customers') {
        const limit = parseInt(url.searchParams.get('limit') ?? '20')
        const offset = parseInt(url.searchParams.get('offset') ?? '0')
        const customers = await this.list({ limit, offset })
        return this.jsonResponse({
          object: 'list',
          data: customers,
          has_more: customers.length === limit,
        })
      }

      if (url.pathname === '/sync-provider') {
        const id = url.searchParams.get('id')
        const provider = url.searchParams.get('provider') as PaymentProvider
        const providerId = url.searchParams.get('provider_id')
        if (!id || !provider || !providerId) {
          return this.errorResponse(400, 'Missing required parameters')
        }
        await this.syncProvider(id, provider, providerId)
        return this.jsonResponse({ success: true })
      }

      return this.errorResponse(404, 'Not found')
    } catch (error) {
      return this.errorResponse(500, error instanceof Error ? error.message : 'Internal error')
    }
  }

  async create(params: CustomerCreateParams): Promise<Customer> {
    const now = Math.floor(Date.now() / 1000)
    const id = `cus_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`

    const customer: Customer = {
      id,
      object: 'customer',
      email: params.email ?? null,
      name: params.name ?? null,
      phone: params.phone ?? null,
      address: params.address ?? null,
      metadata: params.metadata ?? {},
      created: now,
      updated: now,
      provider_ids: {},
      default_payment_method: params.payment_method ?? null,
      balance: 0,
      currency: null,
      delinquent: false,
      livemode: false,
    }

    this.sql.exec(
      `INSERT INTO customers
       (id, email, name, phone, address, metadata, created, updated, provider_ids, default_payment_method, balance, currency, delinquent, livemode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      customer.id,
      customer.email,
      customer.name,
      customer.phone,
      customer.address ? JSON.stringify(customer.address) : null,
      JSON.stringify(customer.metadata),
      customer.created,
      customer.updated,
      JSON.stringify(customer.provider_ids),
      customer.default_payment_method,
      customer.balance,
      customer.currency,
      customer.delinquent ? 1 : 0,
      customer.livemode ? 1 : 0
    )

    // Emit event
    await this.ctx.storage.put(`event:customer.created:${now}`, {
      type: 'customer.created',
      data: { object: customer },
      created: now,
    })

    return customer
  }

  async get(id: string): Promise<Customer | null> {
    const result = this.sql.exec(`SELECT * FROM customers WHERE id = ?`, id)
    const rows = result.toArray()
    if (rows.length === 0) return null

    return this.rowToCustomer(rows[0] as Record<string, unknown>)
  }

  async update(id: string, params: CustomerUpdateParams): Promise<Customer | null> {
    const existing = await this.get(id)
    if (!existing) return null

    const now = Math.floor(Date.now() / 1000)
    const updates: string[] = ['updated = ?']
    const values: unknown[] = [now]

    if (params.email !== undefined) {
      updates.push('email = ?')
      values.push(params.email === '' ? null : params.email)
    }
    if (params.name !== undefined) {
      updates.push('name = ?')
      values.push(params.name === '' ? null : params.name)
    }
    if (params.phone !== undefined) {
      updates.push('phone = ?')
      values.push(params.phone === '' ? null : params.phone)
    }
    if (params.address !== undefined) {
      updates.push('address = ?')
      values.push(params.address === '' ? null : JSON.stringify(params.address))
    }
    if (params.metadata !== undefined) {
      updates.push('metadata = ?')
      values.push(params.metadata === '' ? '{}' : JSON.stringify(params.metadata))
    }
    if (params.default_payment_method !== undefined) {
      updates.push('default_payment_method = ?')
      values.push(params.default_payment_method)
    }

    values.push(id)

    this.sql.exec(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`,
      ...values
    )

    const updated = await this.get(id)

    // Emit event
    await this.ctx.storage.put(`event:customer.updated:${now}`, {
      type: 'customer.updated',
      data: { object: updated, previous_attributes: params },
      created: now,
    })

    return updated
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id)
    if (!existing) return false

    this.sql.exec(`DELETE FROM customers WHERE id = ?`, id)

    // Emit event
    const now = Math.floor(Date.now() / 1000)
    await this.ctx.storage.put(`event:customer.deleted:${now}`, {
      type: 'customer.deleted',
      data: { object: { id, object: 'customer', deleted: true } },
      created: now,
    })

    return true
  }

  async list(options?: { limit?: number; offset?: number }): Promise<Customer[]> {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0

    const result = this.sql.exec(
      `SELECT * FROM customers ORDER BY created DESC LIMIT ? OFFSET ?`,
      limit,
      offset
    )

    return result.toArray().map((row) => this.rowToCustomer(row as Record<string, unknown>))
  }

  async syncProvider(id: string, provider: PaymentProvider, providerId: string): Promise<void> {
    const customer = await this.get(id)
    if (!customer) return

    const providerIds = { ...customer.provider_ids, [provider]: providerId }

    this.sql.exec(
      `UPDATE customers SET provider_ids = ?, updated = ? WHERE id = ?`,
      JSON.stringify(providerIds),
      Math.floor(Date.now() / 1000),
      id
    )
  }

  private rowToCustomer(row: Record<string, unknown>): Customer {
    return {
      id: row.id as string,
      object: 'customer',
      email: row.email as string | null,
      name: row.name as string | null,
      phone: row.phone as string | null,
      address: row.address ? JSON.parse(row.address as string) : null,
      metadata: JSON.parse(row.metadata as string) as Metadata,
      created: row.created as number,
      updated: row.updated as number,
      provider_ids: JSON.parse(row.provider_ids as string) as Record<PaymentProvider, string>,
      default_payment_method: row.default_payment_method as string | null,
      balance: row.balance as number,
      currency: row.currency as Currency | null,
      delinquent: Boolean(row.delinquent),
      livemode: Boolean(row.livemode),
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private errorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// =============================================================================
// PaymentStateDO - Payment State Machine
// =============================================================================

export class PaymentStateDO implements DurableObject {
  private ctx: DurableObjectState
  private sql: SqlStorage

  // Valid state transitions
  private static readonly transitions: Record<PaymentStateType, PaymentStateType[]> = {
    created: ['pending', 'canceled'],
    pending: ['authorized', 'failed', 'canceled'],
    authorized: ['captured', 'canceled'],
    captured: ['partially_refunded', 'refunded', 'disputed'],
    partially_refunded: ['refunded', 'disputed'],
    refunded: [], // Terminal state
    failed: ['pending'], // Allow retry
    canceled: [], // Terminal state
    disputed: ['captured', 'refunded'], // Dispute resolution
  }

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx
    this.sql = ctx.storage.sql
    this.ensureTables()
  }

  private ensureTables(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS payment_states (
        id TEXT PRIMARY KEY,
        payment_intent_id TEXT NOT NULL UNIQUE,
        customer_id TEXT,
        state TEXT NOT NULL,
        amount INTEGER NOT NULL,
        amount_captured INTEGER NOT NULL DEFAULT 0,
        amount_refunded INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        history TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_payment_states_customer ON payment_states(customer_id)
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_payment_states_state ON payment_states(state)
    `)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      if (url.pathname === '/state' || url.pathname === '/') {
        if (method === 'GET') {
          const id = url.searchParams.get('id')
          const paymentIntentId = url.searchParams.get('payment_intent_id')

          if (id) {
            const state = await this.get(id)
            if (!state) return this.errorResponse(404, 'Payment state not found')
            return this.jsonResponse(state)
          }

          if (paymentIntentId) {
            const state = await this.getByPaymentIntent(paymentIntentId)
            if (!state) return this.errorResponse(404, 'Payment state not found')
            return this.jsonResponse(state)
          }

          return this.errorResponse(400, 'ID or payment_intent_id required')
        }

        if (method === 'POST') {
          const params = await request.json() as {
            payment_intent_id: string
            customer_id?: string
            amount: number
            currency: Currency
            provider: PaymentProvider
            provider_id?: string
            metadata?: Metadata
          }
          const state = await this.create(params)
          return this.jsonResponse(state, 201)
        }
      }

      if (url.pathname === '/transition') {
        if (method === 'POST') {
          const params = await request.json() as {
            id: string
            to: PaymentStateType
            reason?: string
            event_id?: string
          }
          const result = await this.transition(params.id, params.to, params.reason, params.event_id)
          if (!result.success) {
            return this.errorResponse(400, result.error ?? 'Transition failed')
          }
          return this.jsonResponse(result.state)
        }
      }

      if (url.pathname === '/capture') {
        if (method === 'POST') {
          const params = await request.json() as { id: string; amount?: number }
          const result = await this.capture(params.id, params.amount)
          if (!result.success) {
            return this.errorResponse(400, result.error ?? 'Capture failed')
          }
          return this.jsonResponse(result.state)
        }
      }

      if (url.pathname === '/refund') {
        if (method === 'POST') {
          const params = await request.json() as { id: string; amount: number }
          const result = await this.refund(params.id, params.amount)
          if (!result.success) {
            return this.errorResponse(400, result.error ?? 'Refund failed')
          }
          return this.jsonResponse(result.state)
        }
      }

      return this.errorResponse(404, 'Not found')
    } catch (error) {
      return this.errorResponse(500, error instanceof Error ? error.message : 'Internal error')
    }
  }

  async create(params: {
    payment_intent_id: string
    customer_id?: string
    amount: number
    currency: Currency
    provider: PaymentProvider
    provider_id?: string
    metadata?: Metadata
  }): Promise<PaymentState> {
    const now = Math.floor(Date.now() / 1000)
    const id = `ps_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`

    const state: PaymentState = {
      id,
      payment_intent_id: params.payment_intent_id,
      customer_id: params.customer_id,
      state: 'created',
      amount: params.amount,
      amount_captured: 0,
      amount_refunded: 0,
      currency: params.currency,
      provider: params.provider,
      provider_id: params.provider_id,
      created_at: now,
      updated_at: now,
      history: [],
      metadata: params.metadata ?? {},
    }

    this.sql.exec(
      `INSERT INTO payment_states
       (id, payment_intent_id, customer_id, state, amount, amount_captured, amount_refunded, currency, provider, provider_id, created_at, updated_at, history, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      state.id,
      state.payment_intent_id,
      state.customer_id ?? null,
      state.state,
      state.amount,
      state.amount_captured,
      state.amount_refunded,
      state.currency,
      state.provider,
      state.provider_id ?? null,
      state.created_at,
      state.updated_at,
      JSON.stringify(state.history),
      JSON.stringify(state.metadata)
    )

    return state
  }

  async get(id: string): Promise<PaymentState | null> {
    const result = this.sql.exec(`SELECT * FROM payment_states WHERE id = ?`, id)
    const rows = result.toArray()
    if (rows.length === 0) return null
    return this.rowToState(rows[0] as Record<string, unknown>)
  }

  async getByPaymentIntent(paymentIntentId: string): Promise<PaymentState | null> {
    const result = this.sql.exec(`SELECT * FROM payment_states WHERE payment_intent_id = ?`, paymentIntentId)
    const rows = result.toArray()
    if (rows.length === 0) return null
    return this.rowToState(rows[0] as Record<string, unknown>)
  }

  async transition(
    id: string,
    to: PaymentStateType,
    reason?: string,
    eventId?: string
  ): Promise<{ success: boolean; state?: PaymentState; error?: string }> {
    const state = await this.get(id)
    if (!state) {
      return { success: false, error: 'Payment state not found' }
    }

    // Validate transition
    const validTransitions = PaymentStateDO.transitions[state.state]
    if (!validTransitions.includes(to)) {
      return {
        success: false,
        error: `Invalid transition from ${state.state} to ${to}`,
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const transition: PaymentStateTransition = {
      from: state.state,
      to,
      timestamp: now,
      reason,
      event_id: eventId,
    }

    const newHistory = [...state.history, transition]

    this.sql.exec(
      `UPDATE payment_states SET state = ?, history = ?, updated_at = ? WHERE id = ?`,
      to,
      JSON.stringify(newHistory),
      now,
      id
    )

    return {
      success: true,
      state: { ...state, state: to, history: newHistory, updated_at: now },
    }
  }

  async capture(id: string, amount?: number): Promise<{ success: boolean; state?: PaymentState; error?: string }> {
    const state = await this.get(id)
    if (!state) {
      return { success: false, error: 'Payment state not found' }
    }

    if (state.state !== 'authorized') {
      return { success: false, error: `Cannot capture from state ${state.state}` }
    }

    const captureAmount = amount ?? state.amount
    if (captureAmount > state.amount) {
      return { success: false, error: 'Capture amount exceeds authorized amount' }
    }

    const now = Math.floor(Date.now() / 1000)
    const transition: PaymentStateTransition = {
      from: 'authorized',
      to: 'captured',
      timestamp: now,
      reason: `Captured ${captureAmount}`,
    }

    const newHistory = [...state.history, transition]

    this.sql.exec(
      `UPDATE payment_states SET state = 'captured', amount_captured = ?, history = ?, updated_at = ? WHERE id = ?`,
      captureAmount,
      JSON.stringify(newHistory),
      now,
      id
    )

    return {
      success: true,
      state: {
        ...state,
        state: 'captured',
        amount_captured: captureAmount,
        history: newHistory,
        updated_at: now,
      },
    }
  }

  async refund(id: string, amount: number): Promise<{ success: boolean; state?: PaymentState; error?: string }> {
    const state = await this.get(id)
    if (!state) {
      return { success: false, error: 'Payment state not found' }
    }

    if (!['captured', 'partially_refunded'].includes(state.state)) {
      return { success: false, error: `Cannot refund from state ${state.state}` }
    }

    const totalRefunded = state.amount_refunded + amount
    if (totalRefunded > state.amount_captured) {
      return { success: false, error: 'Refund amount exceeds captured amount' }
    }

    const newState: PaymentStateType = totalRefunded >= state.amount_captured ? 'refunded' : 'partially_refunded'
    const now = Math.floor(Date.now() / 1000)
    const transition: PaymentStateTransition = {
      from: state.state,
      to: newState,
      timestamp: now,
      reason: `Refunded ${amount}`,
    }

    const newHistory = [...state.history, transition]

    this.sql.exec(
      `UPDATE payment_states SET state = ?, amount_refunded = ?, history = ?, updated_at = ? WHERE id = ?`,
      newState,
      totalRefunded,
      JSON.stringify(newHistory),
      now,
      id
    )

    return {
      success: true,
      state: {
        ...state,
        state: newState,
        amount_refunded: totalRefunded,
        history: newHistory,
        updated_at: now,
      },
    }
  }

  private rowToState(row: Record<string, unknown>): PaymentState {
    return {
      id: row.id as string,
      payment_intent_id: row.payment_intent_id as string,
      customer_id: row.customer_id as string | undefined,
      state: row.state as PaymentStateType,
      amount: row.amount as number,
      amount_captured: row.amount_captured as number,
      amount_refunded: row.amount_refunded as number,
      currency: row.currency as Currency,
      provider: row.provider as PaymentProvider,
      provider_id: row.provider_id as string | undefined,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
      history: JSON.parse(row.history as string) as PaymentStateTransition[],
      metadata: JSON.parse(row.metadata as string) as Metadata,
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private errorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// =============================================================================
// WebhookLogDO - Webhook Event Log for Idempotency
// =============================================================================

export class WebhookLogDO implements DurableObject {
  private ctx: DurableObjectState
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx
    this.sql = ctx.storage.sql
    this.ensureTables()
  }

  private ensureTables(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        processed_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        retries INTEGER DEFAULT 0,
        UNIQUE(event_id, provider)
      )
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status, provider)
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_webhook_processed ON webhook_events(processed_at)
    `)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      if (url.pathname === '/check') {
        const eventId = url.searchParams.get('event_id')
        const provider = url.searchParams.get('provider') as PaymentProvider
        if (!eventId || !provider) {
          return this.errorResponse(400, 'event_id and provider required')
        }
        const processed = await this.hasProcessed(eventId, provider)
        return this.jsonResponse({ processed })
      }

      if (url.pathname === '/log') {
        if (method === 'GET') {
          const eventId = url.searchParams.get('event_id')
          const provider = url.searchParams.get('provider') as PaymentProvider
          if (!eventId || !provider) {
            return this.errorResponse(400, 'event_id and provider required')
          }
          const log = await this.getLog(eventId, provider)
          if (!log) {
            return this.errorResponse(404, 'Log not found')
          }
          return this.jsonResponse(log)
        }

        if (method === 'POST') {
          const log = await request.json() as WebhookEventLog
          await this.saveLog(log)
          return this.jsonResponse({ success: true }, 201)
        }
      }

      if (url.pathname === '/update-status') {
        if (method === 'POST') {
          const params = await request.json() as {
            event_id: string
            provider: PaymentProvider
            status: 'processing' | 'succeeded' | 'failed'
            error?: string
          }
          await this.updateLogStatus(params.event_id, params.provider, params.status, params.error)
          return this.jsonResponse({ success: true })
        }
      }

      if (url.pathname === '/replay') {
        const provider = url.searchParams.get('provider') as PaymentProvider | undefined
        const limit = parseInt(url.searchParams.get('limit') ?? '100')
        const events = await this.getEventsForReplay(provider, limit)
        return this.jsonResponse({ events })
      }

      if (url.pathname === '/stats') {
        const stats = await this.getStats()
        return this.jsonResponse(stats)
      }

      return this.errorResponse(404, 'Not found')
    } catch (error) {
      return this.errorResponse(500, error instanceof Error ? error.message : 'Internal error')
    }
  }

  async hasProcessed(eventId: string, provider: PaymentProvider): Promise<boolean> {
    const result = this.sql.exec(
      `SELECT status FROM webhook_events WHERE event_id = ? AND provider = ?`,
      eventId,
      provider
    )
    const rows = result.toArray()
    return rows.length > 0 && (rows[0] as { status: string }).status === 'succeeded'
  }

  async getLog(eventId: string, provider: PaymentProvider): Promise<WebhookEventLog | null> {
    const result = this.sql.exec(
      `SELECT * FROM webhook_events WHERE event_id = ? AND provider = ?`,
      eventId,
      provider
    )
    const rows = result.toArray()
    if (rows.length === 0) return null

    const row = rows[0] as Record<string, unknown>
    return this.rowToLog(row)
  }

  async saveLog(log: WebhookEventLog): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO webhook_events
       (id, event_id, event_type, provider, payload_hash, processed_at, status, error, retries)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      log.id,
      log.event_id,
      log.event_type,
      log.provider,
      log.payload_hash,
      log.processed_at,
      log.status,
      log.error ?? null,
      log.retries
    )
  }

  async updateLogStatus(
    eventId: string,
    provider: PaymentProvider,
    status: 'processing' | 'succeeded' | 'failed',
    error?: string
  ): Promise<void> {
    if (error) {
      this.sql.exec(
        `UPDATE webhook_events SET status = ?, error = ? WHERE event_id = ? AND provider = ?`,
        status,
        error,
        eventId,
        provider
      )
    } else {
      this.sql.exec(
        `UPDATE webhook_events SET status = ? WHERE event_id = ? AND provider = ?`,
        status,
        eventId,
        provider
      )
    }
  }

  async incrementRetry(eventId: string, provider: PaymentProvider): Promise<void> {
    this.sql.exec(
      `UPDATE webhook_events SET retries = retries + 1 WHERE event_id = ? AND provider = ?`,
      eventId,
      provider
    )
  }

  async getEventsForReplay(provider?: PaymentProvider, limit = 100): Promise<WebhookEventLog[]> {
    let query = `SELECT * FROM webhook_events WHERE status IN ('failed', 'processing')`
    const params: unknown[] = []

    if (provider) {
      query += ` AND provider = ?`
      params.push(provider)
    }

    query += ` ORDER BY processed_at ASC LIMIT ?`
    params.push(limit)

    const result = this.sql.exec(query, ...params)
    return result.toArray().map((row) => this.rowToLog(row as Record<string, unknown>))
  }

  async getStats(): Promise<{
    total: number
    succeeded: number
    failed: number
    processing: number
    by_provider: Record<PaymentProvider, { total: number; succeeded: number; failed: number }>
  }> {
    const totalResult = this.sql.exec(`SELECT COUNT(*) as count FROM webhook_events`)
    const succeededResult = this.sql.exec(`SELECT COUNT(*) as count FROM webhook_events WHERE status = 'succeeded'`)
    const failedResult = this.sql.exec(`SELECT COUNT(*) as count FROM webhook_events WHERE status = 'failed'`)
    const processingResult = this.sql.exec(`SELECT COUNT(*) as count FROM webhook_events WHERE status = 'processing'`)

    const byProviderResult = this.sql.exec(`
      SELECT
        provider,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM webhook_events
      GROUP BY provider
    `)

    const byProvider: Record<string, { total: number; succeeded: number; failed: number }> = {}
    for (const row of byProviderResult.toArray()) {
      const r = row as Record<string, unknown>
      byProvider[r.provider as string] = {
        total: r.total as number,
        succeeded: r.succeeded as number,
        failed: r.failed as number,
      }
    }

    return {
      total: (totalResult.toArray()[0] as { count: number }).count,
      succeeded: (succeededResult.toArray()[0] as { count: number }).count,
      failed: (failedResult.toArray()[0] as { count: number }).count,
      processing: (processingResult.toArray()[0] as { count: number }).count,
      by_provider: byProvider as Record<PaymentProvider, { total: number; succeeded: number; failed: number }>,
    }
  }

  private rowToLog(row: Record<string, unknown>): WebhookEventLog {
    return {
      id: row.id as string,
      event_id: row.event_id as string,
      event_type: row.event_type as WebhookEventLog['event_type'],
      provider: row.provider as PaymentProvider,
      payload_hash: row.payload_hash as string,
      processed_at: row.processed_at as number,
      status: row.status as 'processing' | 'succeeded' | 'failed',
      error: row.error as string | undefined,
      retries: row.retries as number,
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private errorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
