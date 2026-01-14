/**
 * Stripe Subscriptions Resource - Local Implementation
 *
 * Uses WindowManager for billing cycle management.
 * Supports subscription lifecycle: create, update, cancel, pause, resume.
 */

import {
  WindowManager,
  type Window,
  EventTimeTrigger,
  minutes,
} from '../../../../db/primitives/window-manager'
import { createTemporalStore, type TemporalStore } from '../../../../db/primitives/temporal-store'
import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionItem,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionListParams,
  SubscriptionCancelParams,
  ListResponse,
  Price,
  Metadata,
} from '../types'
import type { LocalPricesResource } from './products'

export interface SubscriptionsResourceOptions {
  onEvent?: (type: string, data: unknown) => void
  pricesResource: LocalPricesResource
}

interface BillingCycleElement {
  subscriptionId: string
  type: 'period_start' | 'period_end' | 'trial_end'
  timestamp: number
}

/**
 * Local Subscriptions Resource
 * Uses WindowManager for billing cycle windows
 */
export class LocalSubscriptionsResource {
  private store: TemporalStore<Subscription>
  private subscriptionItems: Map<string, SubscriptionItem[]> = new Map()
  private pricesResource: LocalPricesResource
  private onEvent?: (type: string, data: unknown) => void

  // WindowManager for tracking billing periods
  private billingManager: WindowManager<BillingCycleElement>

  constructor(options: SubscriptionsResourceOptions) {
    this.store = createTemporalStore<Subscription>({
      enableTTL: false,
      retention: { maxVersions: 50 },
    })
    this.pricesResource = options.pricesResource
    this.onEvent = options.onEvent

    // Create window manager with tumbling windows for billing cycles
    // Using 30-minute windows for demo (would be month-sized in production)
    this.billingManager = new WindowManager(
      WindowManager.tumbling<BillingCycleElement>(minutes(30))
    )
    this.billingManager.withTrigger(new EventTimeTrigger())
    this.billingManager.onTrigger((window, elements) => {
      this.handleBillingWindowTrigger(window, elements)
    })
  }

  private generateId(prefix: string = 'sub'): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  private generateItemId(): string {
    return this.generateId('si')
  }

  /**
   * Create a new subscription
   */
  async create(params: SubscriptionCreateParams): Promise<Subscription> {
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId()

    // Determine trial and billing period
    let trialEnd: number | null = null
    let status: SubscriptionStatus = 'active'

    if (params.trial_period_days) {
      trialEnd = now + params.trial_period_days * 24 * 60 * 60
      status = 'trialing'
    } else if (params.trial_end) {
      trialEnd = params.trial_end === 'now' ? now : params.trial_end
      if (trialEnd > now) {
        status = 'trialing'
      }
    }

    // Calculate billing period (default to monthly)
    const billingCycleAnchor = now
    const periodEnd = this.calculatePeriodEnd(now, params.items[0])

    // Create subscription items
    const items: SubscriptionItem[] = []
    for (const itemParam of params.items) {
      let price: Price | undefined

      if (itemParam.price) {
        price = await this.pricesResource.retrieve(itemParam.price)
      } else if (itemParam.price_data) {
        price = await this.pricesResource.create({
          currency: itemParam.price_data.currency,
          product: itemParam.price_data.product,
          product_data: itemParam.price_data.product_data,
          unit_amount: itemParam.price_data.unit_amount,
          unit_amount_decimal: itemParam.price_data.unit_amount_decimal,
          recurring: itemParam.price_data.recurring,
          tax_behavior: itemParam.price_data.tax_behavior,
        })
      }

      if (!price) {
        throw this.createError('parameter_missing', 'Missing required param: items[].price or items[].price_data', 'items')
      }

      const item: SubscriptionItem = {
        id: this.generateItemId(),
        object: 'subscription_item',
        billing_thresholds: null,
        created: now,
        metadata: itemParam.metadata ?? {},
        price,
        quantity: itemParam.quantity ?? 1,
        subscription: id,
        tax_rates: null,
      }
      items.push(item)
    }

    this.subscriptionItems.set(id, items)

    // Determine currency from first price
    const currency = items[0]?.price.currency ?? params.currency ?? 'usd'

    const subscription: Subscription = {
      id,
      object: 'subscription',
      application: null,
      application_fee_percent: null,
      automatic_tax: { enabled: false, liability: null },
      billing_cycle_anchor: billingCycleAnchor,
      billing_thresholds: null,
      cancel_at: null,
      cancel_at_period_end: params.cancel_at_period_end ?? false,
      canceled_at: null,
      cancellation_details: null,
      collection_method: params.collection_method ?? 'charge_automatically',
      created: now,
      currency,
      current_period_end: trialEnd ?? periodEnd,
      current_period_start: now,
      customer: params.customer,
      days_until_due: params.collection_method === 'send_invoice' ? 30 : null,
      default_payment_method: params.default_payment_method ?? null,
      default_source: params.default_source ?? null,
      description: params.description ?? null,
      discount: null,
      ended_at: null,
      items: {
        object: 'list',
        data: items,
        has_more: false,
        url: `/v1/subscription_items?subscription=${id}`,
      },
      latest_invoice: null,
      livemode: false,
      metadata: params.metadata ?? {},
      next_pending_invoice_item_invoice: null,
      on_behalf_of: null,
      pause_collection: null,
      payment_settings: params.payment_settings ?? null,
      pending_invoice_item_interval: null,
      pending_setup_intent: null,
      pending_update: null,
      schedule: null,
      start_date: now,
      status,
      test_clock: null,
      transfer_data: null,
      trial_end: trialEnd,
      trial_settings: params.trial_settings ?? null,
      trial_start: trialEnd ? now : null,
    }

    await this.store.put(id, subscription, Date.now())

    // Track billing period in window manager
    this.billingManager.process(
      { subscriptionId: id, type: 'period_start', timestamp: now },
      now * 1000 // Convert to milliseconds
    )

    this.emitEvent('customer.subscription.created', subscription)
    return subscription
  }

  /**
   * Calculate period end based on price interval
   */
  private calculatePeriodEnd(start: number, itemParam: SubscriptionCreateParams['items'][0]): number {
    // Default to 30 days if no recurring info
    let intervalDays = 30

    // This would need access to price data - simplified for now
    if (itemParam.price_data?.recurring) {
      const { interval, interval_count = 1 } = itemParam.price_data.recurring
      switch (interval) {
        case 'day':
          intervalDays = interval_count
          break
        case 'week':
          intervalDays = interval_count * 7
          break
        case 'month':
          intervalDays = interval_count * 30
          break
        case 'year':
          intervalDays = interval_count * 365
          break
      }
    }

    return start + intervalDays * 24 * 60 * 60
  }

  /**
   * Handle billing window trigger
   */
  private handleBillingWindowTrigger(window: Window, elements: BillingCycleElement[]): void {
    for (const element of elements) {
      if (element.type === 'period_end') {
        // Would trigger invoice generation here
        this.emitEvent('invoice.created', {
          subscription: element.subscriptionId,
          period_start: window.start,
          period_end: window.end,
        })
      }
    }
  }

  /**
   * Retrieve a subscription
   */
  async retrieve(id: string): Promise<Subscription> {
    const subscription = await this.store.get(id)
    if (!subscription) {
      throw this.createError('resource_missing', `No such subscription: '${id}'`, 'id')
    }

    // Ensure items are current
    const items = this.subscriptionItems.get(id) ?? []
    subscription.items = {
      object: 'list',
      data: items,
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`,
    }

    return subscription
  }

  /**
   * Update a subscription
   */
  async update(id: string, params: SubscriptionUpdateParams): Promise<Subscription> {
    const existing = await this.retrieve(id)

    // Handle item updates
    if (params.items) {
      const currentItems = this.subscriptionItems.get(id) ?? []
      const newItems: SubscriptionItem[] = []

      for (const itemParam of params.items) {
        if (itemParam.deleted) {
          // Remove item
          continue
        }

        if (itemParam.id) {
          // Update existing item
          const existingItem = currentItems.find((i) => i.id === itemParam.id)
          if (existingItem) {
            const updated = {
              ...existingItem,
              quantity: itemParam.quantity ?? existingItem.quantity,
              metadata: itemParam.metadata ?? existingItem.metadata,
            }
            newItems.push(updated)
          }
        } else if (itemParam.price) {
          // Add new item
          const price = await this.pricesResource.retrieve(itemParam.price)
          const item: SubscriptionItem = {
            id: this.generateItemId(),
            object: 'subscription_item',
            billing_thresholds: null,
            created: Math.floor(Date.now() / 1000),
            metadata: itemParam.metadata ?? {},
            price,
            quantity: itemParam.quantity ?? 1,
            subscription: id,
            tax_rates: null,
          }
          newItems.push(item)
        }
      }

      this.subscriptionItems.set(id, newItems)
    }

    const items = this.subscriptionItems.get(id) ?? []

    const updated: Subscription = {
      ...existing,
      cancel_at_period_end: params.cancel_at_period_end ?? existing.cancel_at_period_end,
      collection_method: params.collection_method ?? existing.collection_method,
      default_payment_method: params.default_payment_method ?? existing.default_payment_method,
      default_source: params.default_source ?? existing.default_source,
      description: params.description === '' ? null : (params.description ?? existing.description),
      metadata: params.metadata === '' ? {} : (params.metadata ?? existing.metadata),
      pause_collection: params.pause_collection === '' ? null : (params.pause_collection ?? existing.pause_collection),
      payment_settings: params.payment_settings ?? existing.payment_settings,
      items: {
        object: 'list',
        data: items,
        has_more: false,
        url: `/v1/subscription_items?subscription=${id}`,
      },
    }

    // Handle trial end update
    if (params.trial_end !== undefined) {
      if (params.trial_end === 'now') {
        updated.trial_end = Math.floor(Date.now() / 1000)
        updated.status = 'active'
      } else {
        updated.trial_end = params.trial_end
        if (params.trial_end > Math.floor(Date.now() / 1000)) {
          updated.status = 'trialing'
        }
      }
    }

    // Handle pause
    if (params.pause_collection && typeof params.pause_collection === 'object') {
      updated.status = 'paused'
    } else if (existing.status === 'paused' && params.pause_collection === '') {
      updated.status = 'active'
    }

    await this.store.put(id, updated, Date.now())
    this.emitEvent('customer.subscription.updated', updated)
    return updated
  }

  /**
   * Cancel a subscription
   */
  async cancel(id: string, params?: SubscriptionCancelParams): Promise<Subscription> {
    const existing = await this.retrieve(id)
    const now = Math.floor(Date.now() / 1000)

    const updated: Subscription = {
      ...existing,
      status: 'canceled',
      canceled_at: now,
      ended_at: now,
      cancellation_details: params?.cancellation_details
        ? {
            comment: params.cancellation_details.comment ?? null,
            feedback: params.cancellation_details.feedback ?? null,
            reason: 'cancellation_requested',
          }
        : { comment: null, feedback: null, reason: 'cancellation_requested' },
    }

    await this.store.put(id, updated, Date.now())
    this.emitEvent('customer.subscription.deleted', updated)
    return updated
  }

  /**
   * Resume a paused subscription
   */
  async resume(
    id: string,
    params?: {
      billing_cycle_anchor?: 'now' | 'unchanged'
      proration_behavior?: 'always_invoice' | 'create_prorations' | 'none'
    }
  ): Promise<Subscription> {
    const existing = await this.retrieve(id)

    if (existing.status !== 'paused') {
      throw this.createError('invalid_request', 'Subscription is not paused', 'id')
    }

    const now = Math.floor(Date.now() / 1000)
    const updated: Subscription = {
      ...existing,
      status: 'active',
      pause_collection: null,
      billing_cycle_anchor: params?.billing_cycle_anchor === 'now' ? now : existing.billing_cycle_anchor,
    }

    await this.store.put(id, updated, Date.now())
    this.emitEvent('customer.subscription.resumed', updated)
    return updated
  }

  /**
   * List subscriptions
   */
  async list(params?: SubscriptionListParams): Promise<ListResponse<Subscription>> {
    const limit = Math.min(params?.limit ?? 10, 100)
    const subscriptions: Subscription[] = []

    const iterator = this.store.range('sub_', {})
    let result = await iterator.next()

    while (!result.done) {
      const sub = result.value

      // Apply filters
      let matches = true

      if (params?.customer && sub.customer !== params.customer) {
        matches = false
      }
      if (params?.status && params.status !== 'all') {
        if (params.status === 'ended') {
          if (!['canceled', 'incomplete_expired'].includes(sub.status)) {
            matches = false
          }
        } else if (sub.status !== params.status) {
          matches = false
        }
      }
      if (params?.price) {
        const items = this.subscriptionItems.get(sub.id) ?? []
        if (!items.some((i) => i.price.id === params.price)) {
          matches = false
        }
      }
      if (params?.created) {
        if (params.created.gt !== undefined && sub.created <= params.created.gt) matches = false
        if (params.created.gte !== undefined && sub.created < params.created.gte) matches = false
        if (params.created.lt !== undefined && sub.created >= params.created.lt) matches = false
        if (params.created.lte !== undefined && sub.created > params.created.lte) matches = false
      }

      if (matches) {
        // Attach items
        const items = this.subscriptionItems.get(sub.id) ?? []
        sub.items = {
          object: 'list',
          data: items,
          has_more: false,
          url: `/v1/subscription_items?subscription=${sub.id}`,
        }
        subscriptions.push(sub)
      }

      result = await iterator.next()
    }

    // Sort by created descending
    subscriptions.sort((a, b) => b.created - a.created)

    // Cursor pagination
    let startIndex = 0
    if (params?.starting_after) {
      const idx = subscriptions.findIndex((s) => s.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = subscriptions.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < subscriptions.length,
      url: '/v1/subscriptions',
    }
  }

  /**
   * Search subscriptions
   */
  async search(params: {
    query: string
    limit?: number
    page?: string
  }): Promise<{ data: Subscription[]; has_more: boolean; next_page?: string }> {
    const limit = Math.min(params.limit ?? 10, 100)
    const allSubscriptions: Subscription[] = []

    const iterator = this.store.range('sub_', {})
    let result = await iterator.next()

    while (!result.done) {
      const sub = result.value

      // Simple query parsing
      const customerMatch = params.query.match(/customer:"([^"]+)"/)
      const statusMatch = params.query.match(/status:"([^"]+)"/)

      let matches = true
      if (customerMatch && sub.customer !== customerMatch[1]) matches = false
      if (statusMatch && sub.status !== statusMatch[1]) matches = false

      if (matches) {
        const items = this.subscriptionItems.get(sub.id) ?? []
        sub.items = {
          object: 'list',
          data: items,
          has_more: false,
          url: `/v1/subscription_items?subscription=${sub.id}`,
        }
        allSubscriptions.push(sub)
      }

      result = await iterator.next()
    }

    const page = allSubscriptions.slice(0, limit)

    return {
      data: page,
      has_more: allSubscriptions.length > limit,
      next_page: allSubscriptions.length > limit ? 'next' : undefined,
    }
  }

  /**
   * Advance subscription billing (for testing)
   * Simulates time passing to trigger billing events
   */
  advanceBilling(toTimestamp: number): void {
    this.billingManager.advanceWatermark(toTimestamp * 1000)
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.billingManager.dispose()
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
