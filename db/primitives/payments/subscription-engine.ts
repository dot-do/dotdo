/**
 * Subscription Engine - Comprehensive subscription lifecycle management
 *
 * Features:
 * - Full subscription lifecycle (create, update, cancel, pause/resume)
 * - Status transitions (trialing, active, past_due, canceled)
 * - Trial period handling with automatic conversion
 * - Proration on plan changes
 * - Grace period for failed payments
 * - Invoice generation on renewal
 * - Usage aggregation for metered billing
 * - Dunning sequence for failed payments
 * - DO alarm scheduling for renewals
 *
 * @module db/primitives/payments/subscription-engine
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Subscription status
 */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled'
  | 'incomplete'
  | 'unpaid'

/**
 * Billing cycle
 */
export type BillingCycle = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

/**
 * Proration behavior
 */
export type ProrationBehavior = 'create_prorations' | 'none' | 'always_invoice'

/**
 * Collection method
 */
export type CollectionMethod = 'charge_automatically' | 'send_invoice'

/**
 * Cancel behavior
 */
export type CancelBehavior = 'immediately' | 'at_period_end'

/**
 * Invoice status
 */
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

/**
 * Payment status
 */
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'canceled'

/**
 * Usage record action
 */
export type UsageAction = 'increment' | 'set'

/**
 * Dunning step action
 */
export type DunningAction = 'retry' | 'notify' | 'cancel' | 'pause'

// =============================================================================
// Entity Interfaces
// =============================================================================

/**
 * Plan definition
 */
export interface Plan {
  id: string
  name: string
  amount: number
  currency: string
  billingCycle: BillingCycle
  trialDays?: number
  metadata?: Record<string, unknown>
  usageType?: 'licensed' | 'metered'
  unitAmount?: number // For metered plans: price per unit
  includedUnits?: number // For metered plans: units included in base price
  createdAt: Date
  updatedAt: Date
}

/**
 * Subscription record
 */
export interface Subscription {
  id: string
  customerId: string
  planId: string
  status: SubscriptionStatus
  quantity: number
  currentPeriodStart: Date
  currentPeriodEnd: Date
  trialStart?: Date
  trialEnd?: Date
  canceledAt?: Date
  cancelAtPeriodEnd: boolean
  pausedAt?: Date
  metadata?: Record<string, unknown>
  defaultPaymentMethodId?: string
  collectionMethod: CollectionMethod
  latestInvoiceId?: string
  gracePeriodEnd?: Date
  dunningStep?: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Invoice record
 */
export interface Invoice {
  id: string
  subscriptionId: string
  customerId: string
  status: InvoiceStatus
  currency: string
  subtotal: number
  total: number
  amountDue: number
  amountPaid: number
  lineItems: InvoiceLineItem[]
  periodStart: Date
  periodEnd: Date
  dueDate?: Date
  paidAt?: Date
  paymentIntentId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  id: string
  description: string
  amount: number
  quantity: number
  unitAmount: number
  type: 'subscription' | 'proration' | 'usage'
  periodStart?: Date
  periodEnd?: Date
}

/**
 * Usage record
 */
export interface UsageRecord {
  id: string
  subscriptionId: string
  quantity: number
  action: UsageAction
  timestamp: Date
  metadata?: Record<string, unknown>
}

/**
 * Proration item
 */
export interface ProrationItem {
  description: string
  amount: number
  type: 'credit' | 'debit'
}

/**
 * Payment intent (simplified)
 */
export interface PaymentIntent {
  id: string
  amount: number
  currency: string
  status: PaymentStatus
  customerId: string
  paymentMethodId?: string
  invoiceId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Dunning step configuration
 */
export interface DunningStep {
  dayAfterDue: number
  action: DunningAction
  notificationTemplate?: string
}

/**
 * Subscription event
 */
export interface SubscriptionEvent {
  type: string
  subscriptionId: string
  data: Record<string, unknown>
  timestamp: Date
}

// =============================================================================
// Option Interfaces
// =============================================================================

/**
 * Create subscription options
 */
export interface CreateSubscriptionOptions {
  customerId: string
  planId: string
  quantity?: number
  trialDays?: number
  trialEnd?: Date
  defaultPaymentMethodId?: string
  collectionMethod?: CollectionMethod
  metadata?: Record<string, unknown>
  startDate?: Date
  prorationBehavior?: ProrationBehavior
}

/**
 * Update subscription options
 */
export interface UpdateSubscriptionOptions {
  planId?: string
  quantity?: number
  prorationBehavior?: ProrationBehavior
  metadata?: Record<string, unknown>
  defaultPaymentMethodId?: string
  collectionMethod?: CollectionMethod
}

/**
 * Cancel subscription options
 */
export interface CancelSubscriptionOptions {
  cancelBehavior?: CancelBehavior
  reason?: string
}

/**
 * Record usage options
 */
export interface RecordUsageOptions {
  subscriptionId: string
  quantity: number
  action?: UsageAction
  timestamp?: Date
  metadata?: Record<string, unknown>
}

/**
 * Alarm schedule
 */
export interface AlarmSchedule {
  subscriptionId: string
  type: 'renewal' | 'trial_end' | 'grace_period_end' | 'dunning'
  scheduledAt: Date
  data?: Record<string, unknown>
}

/**
 * Subscription engine options
 */
export interface SubscriptionEngineOptions {
  gracePeriodDays?: number
  dunningSteps?: DunningStep[]
  defaultCurrency?: string
  onAlarmScheduled?: (alarm: AlarmSchedule) => void | Promise<void>
  onAlarmCanceled?: (subscriptionId: string, type: string) => void | Promise<void>
  onPaymentAttempt?: (intent: PaymentIntent) => Promise<PaymentIntent>
  onInvoiceCreated?: (invoice: Invoice) => void | Promise<void>
  onStatusChanged?: (subscription: Subscription, previousStatus: SubscriptionStatus) => void | Promise<void>
  onEvent?: (event: SubscriptionEvent) => void | Promise<void>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function addPeriod(date: Date, cycle: BillingCycle): Date {
  const result = new Date(date)
  switch (cycle) {
    case 'daily':
      result.setDate(result.getDate() + 1)
      break
    case 'weekly':
      result.setDate(result.getDate() + 7)
      break
    case 'monthly':
      result.setMonth(result.getMonth() + 1)
      break
    case 'quarterly':
      result.setMonth(result.getMonth() + 3)
      break
    case 'yearly':
      result.setFullYear(result.getFullYear() + 1)
      break
  }
  return result
}

function daysInPeriod(cycle: BillingCycle): number {
  switch (cycle) {
    case 'daily':
      return 1
    case 'weekly':
      return 7
    case 'monthly':
      return 30
    case 'quarterly':
      return 90
    case 'yearly':
      return 365
  }
}

function daysBetween(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

// =============================================================================
// Default Dunning Configuration
// =============================================================================

const DEFAULT_DUNNING_STEPS: DunningStep[] = [
  { dayAfterDue: 1, action: 'retry', notificationTemplate: 'payment_failed' },
  { dayAfterDue: 3, action: 'retry', notificationTemplate: 'payment_retry' },
  { dayAfterDue: 5, action: 'notify', notificationTemplate: 'payment_final_warning' },
  { dayAfterDue: 7, action: 'cancel', notificationTemplate: 'subscription_canceled' },
]

// =============================================================================
// SubscriptionEngine Implementation
// =============================================================================

export class SubscriptionEngine {
  // Storage
  private plans: Map<string, Plan> = new Map()
  private subscriptions: Map<string, Subscription> = new Map()
  private invoices: Map<string, Invoice> = new Map()
  private usageRecords: Map<string, UsageRecord[]> = new Map() // subscriptionId -> records
  private paymentIntents: Map<string, PaymentIntent> = new Map()
  private scheduledAlarms: Map<string, AlarmSchedule[]> = new Map() // subscriptionId -> alarms

  // Configuration
  private options: SubscriptionEngineOptions
  private dunningSteps: DunningStep[]

  constructor(options?: SubscriptionEngineOptions) {
    this.options = options ?? {}
    this.dunningSteps = options?.dunningSteps ?? DEFAULT_DUNNING_STEPS
  }

  // =============================================================================
  // Plan Management
  // =============================================================================

  /**
   * Create a new plan
   */
  createPlan(plan: Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>): Plan {
    const now = new Date()
    const newPlan: Plan = {
      ...plan,
      id: generateId('plan'),
      createdAt: now,
      updatedAt: now,
    }
    this.plans.set(newPlan.id, newPlan)
    return newPlan
  }

  /**
   * Get a plan by ID
   */
  getPlan(planId: string): Plan | null {
    return this.plans.get(planId) ?? null
  }

  /**
   * List all plans
   */
  listPlans(): Plan[] {
    return Array.from(this.plans.values())
  }

  /**
   * Update a plan (does not affect existing subscriptions)
   */
  updatePlan(planId: string, updates: Partial<Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>>): Plan {
    const plan = this.plans.get(planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    const updatedPlan: Plan = {
      ...plan,
      ...updates,
      updatedAt: new Date(),
    }
    this.plans.set(planId, updatedPlan)
    return updatedPlan
  }

  // =============================================================================
  // Subscription Lifecycle
  // =============================================================================

  /**
   * Create a new subscription
   */
  async create(options: CreateSubscriptionOptions): Promise<Subscription> {
    const plan = this.plans.get(options.planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    const now = options.startDate ?? new Date()
    const quantity = options.quantity ?? 1

    // Calculate trial period
    let trialStart: Date | undefined
    let trialEnd: Date | undefined
    let status: SubscriptionStatus = 'active'

    // Determine trial days: explicit trialDays > explicit trialEnd > plan default
    const trialDays = options.trialDays !== undefined
      ? options.trialDays
      : options.trialEnd
        ? undefined
        : plan.trialDays

    if (options.trialEnd) {
      trialStart = now
      trialEnd = options.trialEnd
      status = 'trialing'
    } else if (trialDays && trialDays > 0) {
      trialStart = now
      trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
      status = 'trialing'
    }

    // Calculate billing period
    const periodStart = trialEnd ?? now
    const periodEnd = addPeriod(periodStart, plan.billingCycle)

    const subscription: Subscription = {
      id: generateId('sub'),
      customerId: options.customerId,
      planId: options.planId,
      status,
      quantity,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStart,
      trialEnd,
      cancelAtPeriodEnd: false,
      collectionMethod: options.collectionMethod ?? 'charge_automatically',
      defaultPaymentMethodId: options.defaultPaymentMethodId,
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.subscriptions.set(subscription.id, subscription)

    // Emit event
    await this.emitEvent({
      type: 'subscription.created',
      subscriptionId: subscription.id,
      data: { subscription },
      timestamp: now,
    })

    // Schedule appropriate alarm
    if (status === 'trialing' && trialEnd) {
      await this.scheduleAlarm({
        subscriptionId: subscription.id,
        type: 'trial_end',
        scheduledAt: trialEnd,
      })
    } else {
      // Generate first invoice if not trialing
      if (options.collectionMethod !== 'send_invoice') {
        const invoice = await this.generateInvoice(subscription.id)
        subscription.latestInvoiceId = invoice.id

        // Attempt payment immediately for auto-charge
        await this.attemptPayment(invoice.id)
      }

      // Schedule renewal
      await this.scheduleAlarm({
        subscriptionId: subscription.id,
        type: 'renewal',
        scheduledAt: periodEnd,
      })
    }

    return subscription
  }

  /**
   * Get a subscription by ID
   */
  get(subscriptionId: string): Subscription | null {
    return this.subscriptions.get(subscriptionId) ?? null
  }

  /**
   * List subscriptions for a customer
   */
  listByCustomer(customerId: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (s) => s.customerId === customerId
    )
  }

  /**
   * Update a subscription
   */
  async update(subscriptionId: string, options: UpdateSubscriptionOptions): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (subscription.status === 'canceled') {
      throw new Error('Cannot update canceled subscription')
    }

    const now = new Date()
    const previousPlanId = subscription.planId
    const previousQuantity = subscription.quantity

    // Handle plan change
    if (options.planId && options.planId !== subscription.planId) {
      const newPlan = this.plans.get(options.planId)
      if (!newPlan) {
        throw new Error('New plan not found')
      }

      // Calculate proration if requested
      if (options.prorationBehavior === 'create_prorations') {
        const prorations = this.calculateProration(subscription, options.planId)
        if (prorations.length > 0) {
          // Create proration invoice
          await this.createProrationInvoice(subscription, prorations)
        }
      }

      subscription.planId = options.planId
    }

    // Handle quantity change
    if (options.quantity !== undefined && options.quantity !== subscription.quantity) {
      if (options.prorationBehavior === 'create_prorations') {
        const prorations = this.calculateQuantityProration(
          subscription,
          options.quantity
        )
        if (prorations.length > 0) {
          await this.createProrationInvoice(subscription, prorations)
        }
      }
      subscription.quantity = options.quantity
    }

    // Update other fields
    if (options.defaultPaymentMethodId !== undefined) {
      subscription.defaultPaymentMethodId = options.defaultPaymentMethodId
    }
    if (options.collectionMethod !== undefined) {
      subscription.collectionMethod = options.collectionMethod
    }
    if (options.metadata) {
      subscription.metadata = { ...subscription.metadata, ...options.metadata }
    }

    subscription.updatedAt = now

    // Emit event
    await this.emitEvent({
      type: 'subscription.updated',
      subscriptionId: subscription.id,
      data: {
        subscription,
        previousPlanId,
        previousQuantity,
      },
      timestamp: now,
    })

    return subscription
  }

  /**
   * Cancel a subscription
   */
  async cancel(subscriptionId: string, options?: CancelSubscriptionOptions): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (subscription.status === 'canceled') {
      throw new Error('Subscription already canceled')
    }

    const now = new Date()
    const previousStatus = subscription.status
    const behavior = options?.cancelBehavior ?? 'at_period_end'

    if (behavior === 'immediately') {
      subscription.status = 'canceled'
      subscription.canceledAt = now
      subscription.cancelAtPeriodEnd = false

      // Cancel any scheduled alarms
      await this.cancelAlarms(subscriptionId)
    } else {
      subscription.cancelAtPeriodEnd = true
    }

    subscription.updatedAt = now

    // Emit event
    await this.emitEvent({
      type: behavior === 'immediately' ? 'subscription.canceled' : 'subscription.cancel_scheduled',
      subscriptionId: subscription.id,
      data: {
        subscription,
        reason: options?.reason,
        cancelBehavior: behavior,
      },
      timestamp: now,
    })

    if (previousStatus !== subscription.status) {
      await this.onStatusChange(subscription, previousStatus)
    }

    return subscription
  }

  /**
   * Pause a subscription
   */
  async pause(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (subscription.status !== 'active' && subscription.status !== 'past_due') {
      throw new Error('Can only pause active or past_due subscriptions')
    }

    const now = new Date()
    const previousStatus = subscription.status

    subscription.status = 'paused'
    subscription.pausedAt = now
    subscription.updatedAt = now

    // Cancel renewal alarm while paused
    await this.cancelAlarms(subscriptionId, 'renewal')

    // Emit event
    await this.emitEvent({
      type: 'subscription.paused',
      subscriptionId: subscription.id,
      data: { subscription },
      timestamp: now,
    })

    await this.onStatusChange(subscription, previousStatus)

    return subscription
  }

  /**
   * Resume a paused subscription
   */
  async resume(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (subscription.status !== 'paused') {
      throw new Error('Can only resume paused subscriptions')
    }

    const now = new Date()
    const previousStatus = subscription.status
    const plan = this.plans.get(subscription.planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    // Extend the billing period by the paused duration
    const pausedDuration = now.getTime() - (subscription.pausedAt?.getTime() ?? now.getTime())
    subscription.currentPeriodEnd = new Date(subscription.currentPeriodEnd.getTime() + pausedDuration)

    subscription.status = 'active'
    subscription.pausedAt = undefined
    subscription.updatedAt = now

    // Re-schedule renewal alarm
    await this.scheduleAlarm({
      subscriptionId: subscription.id,
      type: 'renewal',
      scheduledAt: subscription.currentPeriodEnd,
    })

    // Emit event
    await this.emitEvent({
      type: 'subscription.resumed',
      subscriptionId: subscription.id,
      data: { subscription },
      timestamp: now,
    })

    await this.onStatusChange(subscription, previousStatus)

    return subscription
  }

  // =============================================================================
  // Trial Management
  // =============================================================================

  /**
   * End trial early and convert to paid
   */
  async endTrial(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (subscription.status !== 'trialing') {
      throw new Error('Subscription is not in trial')
    }

    return this.handleTrialEnd(subscriptionId)
  }

  /**
   * Handle trial end (called by alarm or endTrial)
   */
  async handleTrialEnd(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const now = new Date()
    const previousStatus = subscription.status
    const plan = this.plans.get(subscription.planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    // Update billing period to start from now
    subscription.currentPeriodStart = now
    subscription.currentPeriodEnd = addPeriod(now, plan.billingCycle)
    subscription.trialEnd = now
    subscription.status = 'active'
    subscription.updatedAt = now

    // Generate first invoice
    const invoice = await this.generateInvoice(subscriptionId)
    subscription.latestInvoiceId = invoice.id

    // Attempt payment
    const paymentResult = await this.attemptPayment(invoice.id)

    if (paymentResult.status === 'failed') {
      subscription.status = 'incomplete'
      subscription.updatedAt = new Date()
    }

    // Schedule renewal
    await this.scheduleAlarm({
      subscriptionId: subscription.id,
      type: 'renewal',
      scheduledAt: subscription.currentPeriodEnd,
    })

    // Emit event
    await this.emitEvent({
      type: 'subscription.trial_ended',
      subscriptionId: subscription.id,
      data: { subscription, invoice },
      timestamp: now,
    })

    await this.onStatusChange(subscription, previousStatus)

    return subscription
  }

  // =============================================================================
  // Billing & Invoices
  // =============================================================================

  /**
   * Generate invoice for current billing period
   */
  async generateInvoice(subscriptionId: string): Promise<Invoice> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const plan = this.plans.get(subscription.planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    const now = new Date()
    const lineItems: InvoiceLineItem[] = []

    // Base subscription charge
    const baseAmount = plan.amount * subscription.quantity
    lineItems.push({
      id: generateId('li'),
      description: `${plan.name} x ${subscription.quantity}`,
      amount: baseAmount,
      quantity: subscription.quantity,
      unitAmount: plan.amount,
      type: 'subscription',
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    })

    // Add usage charges for metered plans
    if (plan.usageType === 'metered') {
      const usageCharge = await this.calculateUsageCharges(subscriptionId, plan)
      if (usageCharge > 0) {
        const usageQuantity = this.getUsageTotal(subscriptionId)
        const includedUnits = plan.includedUnits ?? 0
        const billableUnits = Math.max(0, usageQuantity - includedUnits)

        lineItems.push({
          id: generateId('li'),
          description: `Usage charges (${billableUnits} units @ ${plan.unitAmount ?? 0}/unit)`,
          amount: usageCharge,
          quantity: billableUnits,
          unitAmount: plan.unitAmount ?? 0,
          type: 'usage',
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
        })
      }
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)

    const invoice: Invoice = {
      id: generateId('inv'),
      subscriptionId,
      customerId: subscription.customerId,
      status: 'draft',
      currency: plan.currency,
      subtotal,
      total: subtotal,
      amountDue: subtotal,
      amountPaid: 0,
      lineItems,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      createdAt: now,
      updatedAt: now,
    }

    this.invoices.set(invoice.id, invoice)

    // Finalize invoice
    invoice.status = 'open'
    invoice.updatedAt = new Date()

    // Notify
    if (this.options.onInvoiceCreated) {
      await this.options.onInvoiceCreated(invoice)
    }

    // Emit event
    await this.emitEvent({
      type: 'invoice.created',
      subscriptionId,
      data: { invoice },
      timestamp: now,
    })

    return invoice
  }

  /**
   * Get an invoice by ID
   */
  getInvoice(invoiceId: string): Invoice | null {
    return this.invoices.get(invoiceId) ?? null
  }

  /**
   * List invoices for a subscription
   */
  listInvoices(subscriptionId: string): Invoice[] {
    return Array.from(this.invoices.values()).filter(
      (i) => i.subscriptionId === subscriptionId
    )
  }

  /**
   * Attempt payment for an invoice
   */
  async attemptPayment(invoiceId: string): Promise<PaymentIntent> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    if (invoice.status === 'paid') {
      throw new Error('Invoice already paid')
    }

    const subscription = this.subscriptions.get(invoice.subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const now = new Date()

    // Create payment intent
    let paymentIntent: PaymentIntent = {
      id: generateId('pi'),
      amount: invoice.amountDue,
      currency: invoice.currency,
      status: 'pending',
      customerId: invoice.customerId,
      paymentMethodId: subscription.defaultPaymentMethodId,
      invoiceId: invoice.id,
      createdAt: now,
      updatedAt: now,
    }

    // Call external payment handler if provided
    if (this.options.onPaymentAttempt) {
      paymentIntent = await this.options.onPaymentAttempt(paymentIntent)
    } else {
      // Default: simulate success
      paymentIntent.status = 'succeeded'
      paymentIntent.updatedAt = new Date()
    }

    this.paymentIntents.set(paymentIntent.id, paymentIntent)
    invoice.paymentIntentId = paymentIntent.id

    // Update invoice based on payment result
    if (paymentIntent.status === 'succeeded') {
      invoice.status = 'paid'
      invoice.amountPaid = invoice.amountDue
      invoice.amountDue = 0
      invoice.paidAt = new Date()
      invoice.updatedAt = new Date()

      // Clear any past_due status and grace period
      if (subscription.status === 'past_due') {
        const previousStatus = subscription.status
        subscription.status = 'active'
        subscription.gracePeriodEnd = undefined
        subscription.dunningStep = undefined
        subscription.updatedAt = new Date()

        await this.cancelAlarms(subscription.id, 'grace_period_end')
        await this.cancelAlarms(subscription.id, 'dunning')
        await this.onStatusChange(subscription, previousStatus)
      }

      // Emit event
      await this.emitEvent({
        type: 'invoice.paid',
        subscriptionId: subscription.id,
        data: { invoice, paymentIntent },
        timestamp: new Date(),
      })
    } else if (paymentIntent.status === 'failed') {
      // Enter grace period / dunning
      await this.enterGracePeriod(subscription.id, invoice.id)

      // Emit event
      await this.emitEvent({
        type: 'invoice.payment_failed',
        subscriptionId: subscription.id,
        data: { invoice, paymentIntent },
        timestamp: new Date(),
      })
    }

    return paymentIntent
  }

  /**
   * Mark invoice as paid manually
   */
  async markInvoicePaid(invoiceId: string): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId)
    if (!invoice) {
      throw new Error('Invoice not found')
    }

    const subscription = this.subscriptions.get(invoice.subscriptionId)

    invoice.status = 'paid'
    invoice.amountPaid = invoice.amountDue
    invoice.amountDue = 0
    invoice.paidAt = new Date()
    invoice.updatedAt = new Date()

    // Clear past_due if applicable
    if (subscription && subscription.status === 'past_due') {
      const previousStatus = subscription.status
      subscription.status = 'active'
      subscription.gracePeriodEnd = undefined
      subscription.dunningStep = undefined
      subscription.updatedAt = new Date()

      await this.cancelAlarms(subscription.id, 'grace_period_end')
      await this.cancelAlarms(subscription.id, 'dunning')
      await this.onStatusChange(subscription, previousStatus)
    }

    return invoice
  }

  // =============================================================================
  // Grace Period & Dunning
  // =============================================================================

  /**
   * Enter grace period after payment failure
   */
  private async enterGracePeriod(subscriptionId: string, invoiceId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return

    const now = new Date()
    const previousStatus = subscription.status
    const gracePeriodDays = this.options.gracePeriodDays ?? 7

    subscription.status = 'past_due'
    subscription.gracePeriodEnd = new Date(now.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000)
    subscription.dunningStep = 0
    subscription.updatedAt = now

    // Schedule grace period end alarm
    await this.scheduleAlarm({
      subscriptionId,
      type: 'grace_period_end',
      scheduledAt: subscription.gracePeriodEnd,
      data: { invoiceId },
    })

    // Schedule first dunning step
    if (this.dunningSteps.length > 0) {
      const firstStep = this.dunningSteps[0]
      await this.scheduleAlarm({
        subscriptionId,
        type: 'dunning',
        scheduledAt: new Date(now.getTime() + firstStep.dayAfterDue * 24 * 60 * 60 * 1000),
        data: { step: 0, invoiceId },
      })
    }

    // Emit event
    await this.emitEvent({
      type: 'subscription.past_due',
      subscriptionId,
      data: { subscription, gracePeriodEnd: subscription.gracePeriodEnd },
      timestamp: now,
    })

    await this.onStatusChange(subscription, previousStatus)
  }

  /**
   * Process dunning step
   */
  async processDunningStep(subscriptionId: string, step: number, invoiceId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || subscription.status !== 'past_due') {
      return
    }

    if (step >= this.dunningSteps.length) {
      return
    }

    const dunningStep = this.dunningSteps[step]
    const invoice = this.invoices.get(invoiceId)
    const now = new Date()

    // Emit dunning event
    await this.emitEvent({
      type: 'subscription.dunning_step',
      subscriptionId,
      data: { step, action: dunningStep.action, template: dunningStep.notificationTemplate },
      timestamp: now,
    })

    switch (dunningStep.action) {
      case 'retry':
        if (invoice) {
          await this.attemptPayment(invoice.id)
        }
        break

      case 'notify':
        // Notification is handled by the event listener
        break

      case 'cancel':
        await this.cancel(subscriptionId, { cancelBehavior: 'immediately', reason: 'payment_failed' })
        return // No need to schedule next step

      case 'pause':
        await this.pause(subscriptionId)
        return // No need to schedule next step
    }

    // Schedule next dunning step
    subscription.dunningStep = step + 1
    subscription.updatedAt = now

    if (step + 1 < this.dunningSteps.length) {
      const nextStep = this.dunningSteps[step + 1]
      const nextStepDate = new Date(now.getTime() + (nextStep.dayAfterDue - dunningStep.dayAfterDue) * 24 * 60 * 60 * 1000)

      await this.scheduleAlarm({
        subscriptionId,
        type: 'dunning',
        scheduledAt: nextStepDate,
        data: { step: step + 1, invoiceId },
      })
    }
  }

  /**
   * Handle grace period end
   */
  async handleGracePeriodEnd(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || subscription.status !== 'past_due') {
      return
    }

    // Cancel subscription if still past_due after grace period
    await this.cancel(subscriptionId, { cancelBehavior: 'immediately', reason: 'grace_period_expired' })
  }

  // =============================================================================
  // Usage-Based Billing
  // =============================================================================

  /**
   * Record usage for metered subscription
   */
  async recordUsage(options: RecordUsageOptions): Promise<UsageRecord> {
    const subscription = this.subscriptions.get(options.subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const plan = this.plans.get(subscription.planId)
    if (!plan || plan.usageType !== 'metered') {
      throw new Error('Plan does not support usage-based billing')
    }

    const now = options.timestamp ?? new Date()

    const record: UsageRecord = {
      id: generateId('ur'),
      subscriptionId: options.subscriptionId,
      quantity: options.quantity,
      action: options.action ?? 'increment',
      timestamp: now,
      metadata: options.metadata,
    }

    const records = this.usageRecords.get(options.subscriptionId) ?? []
    records.push(record)
    this.usageRecords.set(options.subscriptionId, records)

    // Emit event
    await this.emitEvent({
      type: 'usage.recorded',
      subscriptionId: options.subscriptionId,
      data: { record },
      timestamp: now,
    })

    return record
  }

  /**
   * Get usage records for a subscription
   */
  getUsageRecords(subscriptionId: string, periodStart?: Date, periodEnd?: Date): UsageRecord[] {
    const records = this.usageRecords.get(subscriptionId) ?? []

    if (!periodStart && !periodEnd) {
      return records
    }

    return records.filter((r) => {
      if (periodStart && r.timestamp < periodStart) return false
      if (periodEnd && r.timestamp > periodEnd) return false
      return true
    })
  }

  /**
   * Get total usage for current billing period
   */
  getUsageTotal(subscriptionId: string): number {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return 0

    const records = this.getUsageRecords(
      subscriptionId,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd
    )

    let total = 0
    for (const record of records) {
      if (record.action === 'set') {
        total = record.quantity
      } else {
        total += record.quantity
      }
    }

    return total
  }

  /**
   * Calculate usage charges for billing
   */
  private async calculateUsageCharges(subscriptionId: string, plan: Plan): Promise<number> {
    if (plan.usageType !== 'metered' || !plan.unitAmount) {
      return 0
    }

    const usageQuantity = this.getUsageTotal(subscriptionId)
    const includedUnits = plan.includedUnits ?? 0
    const billableUnits = Math.max(0, usageQuantity - includedUnits)

    return billableUnits * plan.unitAmount
  }

  /**
   * Clear usage records for a period (typically after billing)
   */
  clearUsageRecords(subscriptionId: string, beforeDate: Date): void {
    const records = this.usageRecords.get(subscriptionId) ?? []
    const filtered = records.filter((r) => r.timestamp >= beforeDate)
    this.usageRecords.set(subscriptionId, filtered)
  }

  // =============================================================================
  // Proration
  // =============================================================================

  /**
   * Calculate proration for plan change
   */
  calculateProration(subscription: Subscription, newPlanId: string): ProrationItem[] {
    const currentPlan = this.plans.get(subscription.planId)
    const newPlan = this.plans.get(newPlanId)

    if (!currentPlan || !newPlan) {
      return []
    }

    const now = new Date()
    const periodDays = daysInPeriod(currentPlan.billingCycle)
    const daysRemaining = daysBetween(now, subscription.currentPeriodEnd)
    const daysUsed = periodDays - daysRemaining

    const items: ProrationItem[] = []

    // Credit for unused portion of current plan
    const unusedCredit = Math.round(
      (currentPlan.amount * subscription.quantity * daysRemaining) / periodDays
    )
    if (unusedCredit > 0) {
      items.push({
        description: `Unused time on ${currentPlan.name}`,
        amount: unusedCredit,
        type: 'credit',
      })
    }

    // Charge for remaining portion of new plan
    const newCharge = Math.round(
      (newPlan.amount * subscription.quantity * daysRemaining) / daysInPeriod(newPlan.billingCycle)
    )
    if (newCharge > 0) {
      items.push({
        description: `Remaining time on ${newPlan.name}`,
        amount: newCharge,
        type: 'debit',
      })
    }

    return items
  }

  /**
   * Calculate proration for quantity change
   */
  calculateQuantityProration(subscription: Subscription, newQuantity: number): ProrationItem[] {
    const plan = this.plans.get(subscription.planId)
    if (!plan) return []

    const now = new Date()
    const periodDays = daysInPeriod(plan.billingCycle)
    const daysRemaining = daysBetween(now, subscription.currentPeriodEnd)
    const quantityDelta = newQuantity - subscription.quantity

    const items: ProrationItem[] = []

    if (quantityDelta > 0) {
      // Adding seats - charge prorated amount
      const charge = Math.round(
        (plan.amount * quantityDelta * daysRemaining) / periodDays
      )
      items.push({
        description: `Add ${quantityDelta} seats (prorated)`,
        amount: charge,
        type: 'debit',
      })
    } else if (quantityDelta < 0) {
      // Removing seats - credit prorated amount
      const credit = Math.round(
        (plan.amount * Math.abs(quantityDelta) * daysRemaining) / periodDays
      )
      items.push({
        description: `Remove ${Math.abs(quantityDelta)} seats (prorated)`,
        amount: credit,
        type: 'credit',
      })
    }

    return items
  }

  /**
   * Create proration invoice
   */
  private async createProrationInvoice(
    subscription: Subscription,
    prorations: ProrationItem[]
  ): Promise<Invoice> {
    const plan = this.plans.get(subscription.planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    const now = new Date()
    const lineItems: InvoiceLineItem[] = prorations.map((p) => ({
      id: generateId('li'),
      description: p.description,
      amount: p.type === 'credit' ? -p.amount : p.amount,
      quantity: 1,
      unitAmount: p.type === 'credit' ? -p.amount : p.amount,
      type: 'proration' as const,
    }))

    const total = lineItems.reduce((sum, item) => sum + item.amount, 0)

    const invoice: Invoice = {
      id: generateId('inv'),
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      status: 'open',
      currency: plan.currency,
      subtotal: total,
      total,
      amountDue: Math.max(0, total),
      amountPaid: 0,
      lineItems,
      periodStart: now,
      periodEnd: subscription.currentPeriodEnd,
      createdAt: now,
      updatedAt: now,
    }

    this.invoices.set(invoice.id, invoice)

    // Auto-charge if amount due > 0
    if (invoice.amountDue > 0 && subscription.collectionMethod === 'charge_automatically') {
      await this.attemptPayment(invoice.id)
    }

    // Emit event
    await this.emitEvent({
      type: 'invoice.proration_created',
      subscriptionId: subscription.id,
      data: { invoice, prorations },
      timestamp: now,
    })

    return invoice
  }

  // =============================================================================
  // Renewal
  // =============================================================================

  /**
   * Process subscription renewal (called by alarm)
   */
  async processRenewal(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return

    // Skip if canceled, paused, or set to cancel at period end
    if (subscription.status === 'canceled' || subscription.status === 'paused') {
      return
    }

    if (subscription.cancelAtPeriodEnd) {
      const previousStatus = subscription.status
      subscription.status = 'canceled'
      subscription.canceledAt = new Date()
      subscription.updatedAt = new Date()

      await this.emitEvent({
        type: 'subscription.canceled',
        subscriptionId,
        data: { subscription, reason: 'cancel_at_period_end' },
        timestamp: new Date(),
      })

      await this.onStatusChange(subscription, previousStatus)
      return
    }

    const plan = this.plans.get(subscription.planId)
    if (!plan) return

    const now = new Date()

    // Advance billing period
    subscription.currentPeriodStart = subscription.currentPeriodEnd
    subscription.currentPeriodEnd = addPeriod(subscription.currentPeriodStart, plan.billingCycle)
    subscription.updatedAt = now

    // Clear usage records for previous period
    this.clearUsageRecords(subscriptionId, subscription.currentPeriodStart)

    // Generate renewal invoice
    const invoice = await this.generateInvoice(subscriptionId)
    subscription.latestInvoiceId = invoice.id

    // Attempt payment
    await this.attemptPayment(invoice.id)

    // Schedule next renewal
    await this.scheduleAlarm({
      subscriptionId,
      type: 'renewal',
      scheduledAt: subscription.currentPeriodEnd,
    })

    // Emit event
    await this.emitEvent({
      type: 'subscription.renewed',
      subscriptionId,
      data: { subscription, invoice },
      timestamp: now,
    })
  }

  // =============================================================================
  // Alarm Scheduling (DO Integration)
  // =============================================================================

  /**
   * Schedule an alarm
   */
  async scheduleAlarm(alarm: AlarmSchedule): Promise<void> {
    const alarms = this.scheduledAlarms.get(alarm.subscriptionId) ?? []

    // Remove existing alarm of same type
    const filtered = alarms.filter((a) => a.type !== alarm.type)
    filtered.push(alarm)
    this.scheduledAlarms.set(alarm.subscriptionId, filtered)

    // Notify external handler
    if (this.options.onAlarmScheduled) {
      await this.options.onAlarmScheduled(alarm)
    }
  }

  /**
   * Cancel scheduled alarms
   */
  async cancelAlarms(subscriptionId: string, type?: string): Promise<void> {
    const alarms = this.scheduledAlarms.get(subscriptionId) ?? []

    if (type) {
      const filtered = alarms.filter((a) => a.type !== type)
      this.scheduledAlarms.set(subscriptionId, filtered)
    } else {
      this.scheduledAlarms.delete(subscriptionId)
    }

    if (this.options.onAlarmCanceled) {
      await this.options.onAlarmCanceled(subscriptionId, type ?? 'all')
    }
  }

  /**
   * Get scheduled alarms for a subscription
   */
  getScheduledAlarms(subscriptionId: string): AlarmSchedule[] {
    return this.scheduledAlarms.get(subscriptionId) ?? []
  }

  /**
   * Process alarm (to be called by DO alarm handler)
   */
  async processAlarm(subscriptionId: string, type: string, data?: Record<string, unknown>): Promise<void> {
    switch (type) {
      case 'renewal':
        await this.processRenewal(subscriptionId)
        break
      case 'trial_end':
        await this.handleTrialEnd(subscriptionId)
        break
      case 'grace_period_end':
        await this.handleGracePeriodEnd(subscriptionId)
        break
      case 'dunning':
        if (data && typeof data.step === 'number' && typeof data.invoiceId === 'string') {
          await this.processDunningStep(subscriptionId, data.step, data.invoiceId)
        }
        break
    }
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  /**
   * Emit subscription event
   */
  private async emitEvent(event: SubscriptionEvent): Promise<void> {
    if (this.options.onEvent) {
      await this.options.onEvent(event)
    }
  }

  /**
   * Handle status change
   */
  private async onStatusChange(subscription: Subscription, previousStatus: SubscriptionStatus): Promise<void> {
    if (this.options.onStatusChanged) {
      await this.options.onStatusChanged(subscription, previousStatus)
    }
  }

  // =============================================================================
  // Statistics & Metrics
  // =============================================================================

  /**
   * Get subscription statistics
   */
  getStats(): {
    total: number
    active: number
    trialing: number
    pastDue: number
    paused: number
    canceled: number
    mrr: number
  } {
    const subscriptions = Array.from(this.subscriptions.values())

    let mrr = 0
    for (const sub of subscriptions) {
      if (sub.status === 'active' || sub.status === 'trialing') {
        const plan = this.plans.get(sub.planId)
        if (plan) {
          let monthlyAmount = plan.amount * sub.quantity
          switch (plan.billingCycle) {
            case 'daily':
              monthlyAmount *= 30
              break
            case 'weekly':
              monthlyAmount *= 4
              break
            case 'quarterly':
              monthlyAmount /= 3
              break
            case 'yearly':
              monthlyAmount /= 12
              break
          }
          mrr += monthlyAmount
        }
      }
    }

    return {
      total: subscriptions.length,
      active: subscriptions.filter((s) => s.status === 'active').length,
      trialing: subscriptions.filter((s) => s.status === 'trialing').length,
      pastDue: subscriptions.filter((s) => s.status === 'past_due').length,
      paused: subscriptions.filter((s) => s.status === 'paused').length,
      canceled: subscriptions.filter((s) => s.status === 'canceled').length,
      mrr: Math.round(mrr),
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new SubscriptionEngine instance
 */
export function createSubscriptionEngine(options?: SubscriptionEngineOptions): SubscriptionEngine {
  return new SubscriptionEngine(options)
}
