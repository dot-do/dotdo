/**
 * Stripe Compat Layer v2 - Built on dotdo primitives
 * Demonstrates how Protocol + Resource + Channel + Machine make SDKs trivial
 */

import { Protocol } from '../../../primitives/protocol/index'
import { InMemoryResource, type Entity } from '../../../primitives/resource/index'
import { createChannel, type Channel } from '../../../primitives/channel/index'
import { Machine, type Machine as MachineInstance } from '../../../primitives/machine/index'

// Types
export interface PaymentIntent extends Entity {
  amount: number; currency: string; status: PaymentStatus
  customer?: string; metadata?: Record<string, string>; created: number
}
export type PaymentStatus = 'requires_payment_method' | 'requires_confirmation' | 'processing' | 'succeeded' | 'canceled' | 'requires_capture'

export interface Customer extends Entity {
  email: string; name?: string; metadata?: Record<string, string>; created: number
}

export interface WebhookEvent {
  id: string; type: string; data: { object: unknown }; created: number
}

type PaymentState = 'pending' | 'requires_confirmation' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded'
type PaymentEvent = { type: 'CONFIRM' } | { type: 'PROCESS' } | { type: 'SUCCEED' } | { type: 'FAIL' } | { type: 'CANCEL' } | { type: 'REFUND' }
interface PaymentContext { intentId: string; amount: number; error?: string }

// Payment Flow State Machine
const paymentFlowMachine = Machine.define<PaymentState, PaymentEvent, PaymentContext>({
  id: 'payment_flow', initial: 'pending', context: { intentId: '', amount: 0 },
  states: {
    pending: { on: { CONFIRM: 'requires_confirmation', CANCEL: 'canceled' } },
    requires_confirmation: { on: { PROCESS: 'processing', CANCEL: 'canceled' } },
    processing: { on: { SUCCEED: 'succeeded', FAIL: 'failed' } },
    succeeded: { on: { REFUND: 'refunded' } },
    failed: { on: { CONFIRM: 'requires_confirmation' } },
    canceled: { type: 'final' },
    refunded: { type: 'final' },
  },
})

// Internal Payments Protocol (defines operations declaratively)
const paymentsProtocol = Protocol.define({
  name: 'payments', version: '1.0.0',
  config: { apiKey: { type: 'string' as const, required: true } },
  operations: {
    createPayment: { type: 'pipe' as const, handler: async (i: { amount: number; currency: string }) => i },
    confirmPayment: { type: 'pipe' as const, handler: async (i: { id: string }) => i },
    capturePayment: { type: 'pipe' as const, handler: async (i: { id: string }) => i },
    cancelPayment: { type: 'pipe' as const, handler: async (i: { id: string }) => i },
    customers: { type: 'resource' as const, schema: {} },
    events: { type: 'channel' as const },
    paymentFlow: { type: 'machine' as const, config: paymentFlowMachine },
  },
})

// Stripe SDK Class
export class Stripe {
  private apiKey: string
  private _customers: InMemoryResource<Customer>
  private _paymentIntents: InMemoryResource<PaymentIntent>
  private _webhookChannel: Channel<WebhookEvent>
  private _flows: Map<string, MachineInstance<PaymentState, PaymentEvent, PaymentContext>>

  readonly paymentIntents: PaymentIntentsResource
  readonly customers: CustomersResource
  readonly webhooks: WebhooksResource

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('Stripe API key is required')
    this.apiKey = apiKey
    this._customers = new InMemoryResource<Customer>()
    this._paymentIntents = new InMemoryResource<PaymentIntent>()
    this._webhookChannel = createChannel<WebhookEvent>('stripe_webhooks')
    this._flows = new Map()
    this.paymentIntents = new PaymentIntentsResource(this)
    this.customers = new CustomersResource(this)
    this.webhooks = new WebhooksResource(this)
  }

  get _intents() { return this._paymentIntents }
  get _cust() { return this._customers }
  get _channel() { return this._webhookChannel }

  paymentFlow(intentId: string): MachineInstance<PaymentState, PaymentEvent, PaymentContext> {
    let flow = this._flows.get(intentId)
    if (!flow) { flow = paymentFlowMachine.create({ intentId, amount: 0 }); this._flows.set(intentId, flow) }
    return flow
  }
}

// PaymentIntents Resource (Pipe operations)
class PaymentIntentsResource {
  constructor(private stripe: Stripe) {}

  async create(p: { amount: number; currency: string; customer?: string; metadata?: Record<string, string> }) {
    const intent = await this.stripe._intents.create({
      amount: p.amount, currency: p.currency, status: 'requires_payment_method',
      customer: p.customer, metadata: p.metadata ?? {}, created: Date.now(),
    })
    this.stripe.paymentFlow(intent.id)
    return intent
  }

  async retrieve(id: string) { return this.stripe._intents.get(id) }

  async confirm(id: string) {
    const flow = this.stripe.paymentFlow(id)
    await flow.send({ type: 'CONFIRM' }); await flow.send({ type: 'PROCESS' }); await flow.send({ type: 'SUCCEED' })
    const intent = await this.stripe._intents.update(id, { status: 'succeeded' })
    await this.stripe._channel.publish('payment_intent.succeeded', {
      id: `evt_${Date.now()}`, type: 'payment_intent.succeeded', data: { object: intent }, created: Date.now(),
    })
    return intent
  }

  async capture(id: string, p?: { amount_to_capture?: number }) {
    return this.stripe._intents.update(id, { status: 'succeeded' })
  }

  async cancel(id: string, p?: { cancellation_reason?: string }) {
    await this.stripe.paymentFlow(id).send({ type: 'CANCEL' })
    return this.stripe._intents.update(id, { status: 'canceled' })
  }

  async *list(p?: { customer?: string; limit?: number }): AsyncGenerator<PaymentIntent> {
    for await (const i of this.stripe._intents.find(p?.customer ? { customer: p.customer } : undefined)) yield i
  }
}

// Customers Resource (CRUD operations)
class CustomersResource {
  constructor(private stripe: Stripe) {}

  async create(p: { email: string; name?: string; metadata?: Record<string, string> }) {
    return this.stripe._cust.create({ email: p.email, name: p.name, metadata: p.metadata ?? {}, created: Date.now() })
  }

  async retrieve(id: string) { return this.stripe._cust.get(id) }

  async update(id: string, p: Partial<Pick<Customer, 'email' | 'name' | 'metadata'>>) {
    return this.stripe._cust.update(id, p)
  }

  async del(id: string) { await this.stripe._cust.delete(id); return { id, deleted: true } }

  async *list(p?: { email?: string; limit?: number }): AsyncGenerator<Customer> {
    for await (const c of this.stripe._cust.find(p?.email ? { email: p.email } : undefined)) yield c
  }
}

// Webhooks Resource (Channel operations)
class WebhooksResource {
  constructor(private stripe: Stripe) {}
  on(event: string, handler: (e: WebhookEvent) => void) { const s = this.stripe._channel.subscribe(event, handler); return () => s.unsubscribe() }
  onAny(handler: (e: WebhookEvent) => void) { const s = this.stripe._channel.subscribe('*', handler); return () => s.unsubscribe() }
}

export default Stripe
