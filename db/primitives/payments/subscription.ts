/**
 * Subscription Manager - Comprehensive subscription lifecycle management
 *
 * Features:
 * - Full subscription lifecycle (create, update, cancel, pause/resume)
 * - Status transitions (trialing, active, past_due, canceled, paused, unpaid)
 * - Trial period handling with automatic conversion
 * - Proration on plan changes
 * - Grace period for failed payments
 * - Usage-based billing for metered plans
 * - Dunning sequence for failed payments
 * - Event emission for webhooks
 *
 * @module db/primitives/payments/subscription
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
 * Billing interval
 */
export type BillingInterval = 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * Proration behavior
 */
export type ProrationBehavior = 'create_prorations' | 'none' | 'always_invoice'

/**
 * Billing cycle anchor
 */
export type BillingCycleAnchor = Date

/**
 * Refund type on cancellation
 */
export type RefundType = 'prorate' | 'full' | 'none'

/**
 * Plan definition
 */
export interface Plan {
  id: string
  name: string
  amount: number
  currency: string
  interval: BillingInterval
  intervalCount: number
  active: boolean
  metadata: Record<string, unknown>
  billingScheme?: 'per_unit' | 'metered'
  usageType?: 'licensed' | 'metered'
  unitAmount?: number
  trialDays?: number
}

/**
 * Subscription item (for multi-plan subscriptions)
 */
export interface SubscriptionItem {
  id: string
  planId: string
  quantity: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Usage record for metered billing
 */
export interface UsageRecord {
  id: string
  subscriptionId: string
  quantity: number
  action: 'increment' | 'set'
  timestamp: Date
  metadata?: Record<string, unknown>
}

/**
 * Trial configuration
 */
export interface TrialConfig {
  requirePaymentMethod?: boolean
  endBehavior?: 'cancel_if_payment_fails' | 'create_invoice' | 'pause'
  convertToPaid?: boolean
}

/**
 * Pause configuration
 */
export interface PauseConfig {
  maxPauseDays?: number
  maxPausesPerYear?: number
}

/**
 * Dunning configuration
 */
export interface DunningConfig {
  maxRetries?: number
  retrySchedule?: number[] // days after failure to retry
  sendDunningEmails?: boolean
  cancelAfterMaxRetries?: boolean
  markUnpaidAfterMaxRetries?: boolean
  smartRetry?: boolean
}

/**
 * Payment retry schedule
 */
export interface PaymentRetrySchedule {
  days: number[]
  maxAttempts: number
}

/**
 * Cancellation details
 */
export interface CancellationDetails {
  reason?: string
  feedback?: string
  canceledAt?: Date
  effectiveAt?: Date
}

/**
 * Status history entry
 */
export interface StatusHistoryEntry {
  status: SubscriptionStatus
  timestamp: Date
  reason?: string
}

/**
 * Scheduled plan change
 */
export interface ScheduledPlanChange {
  planId: string
  effectiveAt: Date
}

/**
 * Proration item
 */
export interface ProrationItem {
  description: string
  amount: number
  type: 'credit' | 'debit'
  periodStart?: Date
  periodEnd?: Date
}

/**
 * Plan change result
 */
export interface PlanChangeResult {
  subscription: Subscription
  prorationItems: ProrationItem[]
  amountDue?: number
  creditApplied?: number
  invoiceId?: string
  invoiceStatus?: 'paid' | 'open' | 'draft'
}

/**
 * Invoice preview
 */
export interface InvoicePreview {
  currentPlanId: string
  newPlanId: string
  prorationItems: ProrationItem[]
  amountDue: number
  subtotal: number
  total: number
}

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  id: string
  description: string
  amount: number
  quantity: number
  type: 'subscription' | 'proration' | 'usage'
}

/**
 * Invoice
 */
export interface Invoice {
  id: string
  subscriptionId: string
  customerId: string
  amount: number
  currency: string
  status: 'draft' | 'open' | 'paid' | 'void'
  lineItems: InvoiceLineItem[]
  periodStart: Date
  periodEnd: Date
  createdAt: Date
  paidAt?: Date
}

/**
 * Refund record
 */
export interface Refund {
  id: string
  subscriptionId: string
  amount: number
  reason?: string
  createdAt: Date
}

/**
 * Access check result
 */
export interface AccessCheckResult {
  hasAccess: boolean
  expiresAt?: Date
  reason?: string
  inTrial?: boolean
}

/**
 * Billing result
 */
export interface BillingResult {
  success?: boolean
  skipped?: boolean
  reason?: string
  invoiceId?: string
  amount?: number
}

/**
 * Usage summary
 */
export interface UsageSummary {
  totalQuantity: number
  estimatedAmount: number
  records: UsageRecord[]
}

/**
 * Dunning history entry
 */
export interface DunningHistoryEntry {
  paymentId: string
  failureCode: string
  failureMessage?: string
  timestamp: Date
  retryNumber: number
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
  currentAmount: number
  billingCycleAnchor: Date
  items: SubscriptionItem[]
  trialStart?: Date
  trialEnd?: Date
  canceledAt?: Date
  cancelAtPeriodEnd: boolean
  cancelAt?: Date
  pausedAt?: Date
  resumeAt?: Date
  metadata?: Record<string, unknown>
  paymentMethodId?: string
  latestInvoiceId?: string
  retryCount: number
  nextRetryAt?: Date
  statusHistory: StatusHistoryEntry[]
  cancellationDetails?: CancellationDetails
  scheduledPlanChange?: ScheduledPlanChange
  dunningConfig?: DunningConfig
  trialConfig?: TrialConfig
  pauseConfig?: PauseConfig
  refundAmount?: number
  refundId?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Create subscription options
 */
export interface CreateSubscriptionOptions {
  customerId: string
  planId?: string
  items?: Array<{ planId: string; quantity: number }>
  quantity?: number
  paymentMethodId?: string
  trialDays?: number
  trialEnd?: Date
  trialConfig?: TrialConfig
  billingCycleAnchor?: Date
  prorateBillingCycleAnchor?: boolean
  startDate?: Date
  metadata?: Record<string, unknown>
  dunning?: DunningConfig
  pauseConfig?: PauseConfig
}

/**
 * Cancel subscription options
 */
export interface CancelSubscriptionOptions {
  atPeriodEnd?: boolean
  reason?: string
  feedback?: string
  refund?: RefundType
}

/**
 * Pause subscription options
 */
export interface PauseSubscriptionOptions {
  resumeAt?: Date
  pauseDays?: number
}

/**
 * Plan change options
 */
export interface PlanChangeOptions {
  newPlanId: string
  prorationBehavior?: ProrationBehavior
  effectiveDate?: 'now' | 'period_end'
}

/**
 * Quantity update options
 */
export interface QuantityUpdateOptions {
  quantity: number
  prorationBehavior?: ProrationBehavior
}

/**
 * Billing anchor update options
 */
export interface BillingAnchorUpdateOptions {
  newAnchor: Date
  prorationBehavior?: ProrationBehavior
}

/**
 * Payment failure details
 */
export interface PaymentFailureDetails {
  paymentId: string
  failureCode: string
  failureMessage?: string
}

/**
 * Payment success details
 */
export interface PaymentSuccessDetails {
  paymentId: string
  amount: number
}

/**
 * Trial end options
 */
export interface TrialEndOptions {
  paymentFailed?: boolean
  failureCode?: string
}

/**
 * Record usage options
 */
export interface RecordUsageOptions {
  quantity: number
  timestamp?: Date
  action?: 'increment' | 'set'
  metadata?: Record<string, unknown>
}

/**
 * Event types
 */
export type SubscriptionEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.status_changed'
  | 'subscription.trial_ending'
  | 'subscription.renewed'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'dunning.email_sent'
  | 'payment.retry'

/**
 * Subscription event payload
 */
export interface SubscriptionEventPayload {
  subscriptionId: string
  customerId?: string
  previousStatus?: SubscriptionStatus
  newStatus?: SubscriptionStatus
  trialEndsAt?: Date
  previousPeriodEnd?: Date
  newPeriodEnd?: Date
  cancellationType?: 'immediate' | 'at_period_end'
  emailType?: string
  retryNumber?: number
}

/**
 * Event handler
 */
export type SubscriptionEventHandler = (payload: SubscriptionEventPayload) => void | Promise<void>

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function addInterval(date: Date, interval: BillingInterval, count: number = 1): Date {
  const result = new Date(date)
  switch (interval) {
    case 'day':
      result.setDate(result.getDate() + count)
      break
    case 'week':
      result.setDate(result.getDate() + 7 * count)
      break
    case 'month':
      result.setMonth(result.getMonth() + count)
      break
    case 'quarter':
      result.setMonth(result.getMonth() + 3 * count)
      break
    case 'year':
      result.setFullYear(result.getFullYear() + count)
      break
  }
  return result
}

function daysInInterval(interval: BillingInterval): number {
  switch (interval) {
    case 'day':
      return 1
    case 'week':
      return 7
    case 'month':
      return 30
    case 'quarter':
      return 90
    case 'year':
      return 365
  }
}

function daysBetween(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

// =============================================================================
// SubscriptionManager Implementation
// =============================================================================

export class SubscriptionManager {
  // Storage
  private plans: Map<string, Plan> = new Map()
  private subscriptions: Map<string, Subscription> = new Map()
  private invoices: Map<string, Invoice> = new Map()
  private usageRecords: Map<string, UsageRecord[]> = new Map()
  private refunds: Map<string, Refund> = new Map()
  private dunningHistory: Map<string, DunningHistoryEntry[]> = new Map()
  private validPaymentMethods: Set<string> = new Set()

  // Event handlers
  private eventHandlers: Map<SubscriptionEventType, SubscriptionEventHandler[]> = new Map()

  constructor() {
    // Register some default valid payment methods for testing
    this.validPaymentMethods.add('pm_')
  }

  // =============================================================================
  // Plan Management
  // =============================================================================

  /**
   * Register a plan (for testing)
   */
  registerPlan(plan: Plan): void {
    this.plans.set(plan.id, plan)
  }

  /**
   * Get a plan
   */
  getPlan(planId: string): Plan | null {
    return this.plans.get(planId) ?? null
  }

  /**
   * Register a valid payment method (for testing)
   */
  registerPaymentMethod(paymentMethodId: string): void {
    this.validPaymentMethods.add(paymentMethodId)
  }

  /**
   * Check if payment method is valid
   */
  private isValidPaymentMethod(paymentMethodId: string | undefined): boolean {
    if (!paymentMethodId) return false
    // Check exact match or prefix match
    if (this.validPaymentMethods.has(paymentMethodId)) return true
    for (const pm of this.validPaymentMethods) {
      if (paymentMethodId.startsWith(pm)) return true
    }
    return false
  }

  // =============================================================================
  // Subscription Lifecycle
  // =============================================================================

  /**
   * Create a new subscription
   */
  async create(options: CreateSubscriptionOptions): Promise<Subscription> {
    const now = options.startDate ?? new Date()

    // Validate plan
    const planId = options.planId ?? options.items?.[0]?.planId
    if (!planId) {
      throw new Error('Plan ID is required')
    }

    const plan = this.plans.get(planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    // Validate payment method
    const requirePaymentMethod = options.trialConfig?.requirePaymentMethod !== false
    if (requirePaymentMethod && options.paymentMethodId) {
      if (!this.isValidPaymentMethod(options.paymentMethodId)) {
        throw new Error('Invalid payment method')
      }
    }

    const quantity = options.quantity ?? 1

    // Calculate trial period
    let trialStart: Date | undefined
    let trialEnd: Date | undefined
    let status: SubscriptionStatus = 'active'

    if (options.trialEnd) {
      trialStart = now
      trialEnd = options.trialEnd
      status = 'trialing'
    } else if (options.trialDays && options.trialDays > 0) {
      trialStart = now
      trialEnd = new Date(now.getTime() + options.trialDays * 24 * 60 * 60 * 1000)
      status = 'trialing'
    }

    // Calculate billing period
    const billingAnchor = options.billingCycleAnchor ?? now
    const periodStart = trialEnd ?? now
    const periodEnd = addInterval(periodStart, plan.interval, plan.intervalCount)

    // Build subscription items
    const items: SubscriptionItem[] = options.items?.map((item) => ({
      id: generateId('si'),
      planId: item.planId,
      quantity: item.quantity,
      createdAt: now,
      updatedAt: now,
    })) ?? [{
      id: generateId('si'),
      planId,
      quantity,
      createdAt: now,
      updatedAt: now,
    }]

    // Calculate current amount
    let currentAmount = 0
    for (const item of items) {
      const itemPlan = this.plans.get(item.planId)
      if (itemPlan) {
        currentAmount += itemPlan.amount * item.quantity
      }
    }

    const subscription: Subscription = {
      id: generateId('sub'),
      customerId: options.customerId,
      planId,
      status,
      quantity,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      currentAmount,
      billingCycleAnchor: billingAnchor,
      items,
      trialStart,
      trialEnd,
      cancelAtPeriodEnd: false,
      paymentMethodId: options.paymentMethodId,
      metadata: options.metadata,
      retryCount: 0,
      statusHistory: [{ status, timestamp: now }],
      dunningConfig: options.dunning,
      trialConfig: options.trialConfig,
      pauseConfig: options.pauseConfig,
      createdAt: now,
      updatedAt: now,
    }

    this.subscriptions.set(subscription.id, subscription)

    // Emit event
    await this.emit('subscription.created', {
      subscriptionId: subscription.id,
      customerId: options.customerId,
    })

    return subscription
  }

  /**
   * Get a subscription by ID
   */
  async get(subscriptionId: string): Promise<Subscription | null> {
    return this.subscriptions.get(subscriptionId) ?? null
  }

  /**
   * Update subscription metadata
   */
  async update(subscriptionId: string, updates: { metadata?: Record<string, unknown> }): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (updates.metadata) {
      subscription.metadata = { ...subscription.metadata, ...updates.metadata }
    }
    subscription.updatedAt = new Date()

    await this.emit('subscription.updated', {
      subscriptionId: subscription.id,
    })

    return subscription
  }

  // =============================================================================
  // Payment Handling
  // =============================================================================

  /**
   * Handle payment failure
   */
  async handlePaymentFailed(subscriptionId: string, details: PaymentFailureDetails): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return

    const previousStatus = subscription.status
    const retryCount = subscription.retryCount + 1

    // Record dunning history
    const history = this.dunningHistory.get(subscriptionId) ?? []
    history.push({
      paymentId: details.paymentId,
      failureCode: details.failureCode,
      failureMessage: details.failureMessage,
      timestamp: new Date(),
      retryNumber: retryCount,
    })
    this.dunningHistory.set(subscriptionId, history)

    // Check if max retries exceeded
    const maxRetries = subscription.dunningConfig?.maxRetries ?? 4

    if (retryCount > maxRetries) {
      if (subscription.dunningConfig?.cancelAfterMaxRetries) {
        subscription.status = 'canceled'
        subscription.canceledAt = new Date()
        subscription.cancellationDetails = {
          reason: 'payment_failed',
          canceledAt: new Date(),
        }
      } else if (subscription.dunningConfig?.markUnpaidAfterMaxRetries) {
        subscription.status = 'unpaid'
      }
    } else {
      subscription.status = 'past_due'

      // Schedule next retry
      const retrySchedule = subscription.dunningConfig?.retrySchedule ?? [1, 3, 5, 7]
      if (retryCount <= retrySchedule.length) {
        const daysToRetry = retrySchedule[retryCount - 1]
        subscription.nextRetryAt = new Date(Date.now() + daysToRetry * 24 * 60 * 60 * 1000)
      }
    }

    subscription.retryCount = retryCount
    subscription.statusHistory.push({ status: subscription.status, timestamp: new Date() })
    subscription.updatedAt = new Date()

    // Emit status change event
    if (previousStatus !== subscription.status) {
      await this.emit('subscription.status_changed', {
        subscriptionId,
        previousStatus,
        newStatus: subscription.status,
      })
    }

    // Emit dunning email event
    if (subscription.dunningConfig?.sendDunningEmails) {
      await this.emit('dunning.email_sent', {
        subscriptionId,
        customerId: subscription.customerId,
        emailType: 'payment_failed',
        retryNumber: retryCount,
      })
    }
  }

  /**
   * Handle payment success
   */
  async handlePaymentSucceeded(subscriptionId: string, _details: PaymentSuccessDetails): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return

    const previousStatus = subscription.status

    subscription.status = 'active'
    subscription.retryCount = 0
    subscription.nextRetryAt = undefined
    subscription.statusHistory.push({ status: subscription.status, timestamp: new Date() })
    subscription.updatedAt = new Date()

    if (previousStatus !== subscription.status) {
      await this.emit('subscription.status_changed', {
        subscriptionId,
        previousStatus,
        newStatus: subscription.status,
      })
    }
  }

  // =============================================================================
  // Trial Management
  // =============================================================================

  /**
   * Process trial end
   */
  async processTrialEnd(subscriptionId: string, options?: TrialEndOptions): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    // Check if payment method is required
    if (!subscription.paymentMethodId) {
      throw new Error('Payment method required')
    }

    const previousStatus = subscription.status
    const now = new Date()

    if (options?.paymentFailed) {
      if (subscription.trialConfig?.endBehavior === 'cancel_if_payment_fails') {
        subscription.status = 'canceled'
        subscription.canceledAt = now
      } else {
        subscription.status = 'past_due'
      }
    } else if (subscription.trialConfig?.convertToPaid === false) {
      subscription.status = 'canceled'
      subscription.canceledAt = now
    } else {
      subscription.status = 'active'
      subscription.currentPeriodStart = now
      const plan = this.plans.get(subscription.planId)
      if (plan) {
        subscription.currentPeriodEnd = addInterval(now, plan.interval, plan.intervalCount)
      }
    }

    subscription.trialEnd = now
    subscription.statusHistory.push({ status: subscription.status, timestamp: now })
    subscription.updatedAt = now

    if (previousStatus !== subscription.status) {
      await this.emit('subscription.status_changed', {
        subscriptionId,
        previousStatus,
        newStatus: subscription.status,
      })
    }
  }

  /**
   * Extend trial period
   */
  async extendTrial(subscriptionId: string, options: { additionalDays: number }): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    if (subscription.trialEnd) {
      subscription.trialEnd = new Date(
        subscription.trialEnd.getTime() + options.additionalDays * 24 * 60 * 60 * 1000
      )
    }
    subscription.updatedAt = new Date()

    return subscription
  }

  /**
   * End trial early
   */
  async endTrialEarly(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const now = new Date()
    subscription.status = 'active'
    subscription.trialEnd = now
    subscription.currentPeriodStart = now
    const plan = this.plans.get(subscription.planId)
    if (plan) {
      subscription.currentPeriodEnd = addInterval(now, plan.interval, plan.intervalCount)
    }
    subscription.statusHistory.push({ status: subscription.status, timestamp: now })
    subscription.updatedAt = now

    return subscription
  }

  /**
   * Check if trial is ending soon
   */
  async checkTrialEnding(subscriptionId: string, options: { warningDays: number }): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || subscription.status !== 'trialing' || !subscription.trialEnd) return

    const daysUntilEnd = daysBetween(new Date(), subscription.trialEnd)

    if (daysUntilEnd <= options.warningDays) {
      await this.emit('subscription.trial_ending', {
        subscriptionId,
        trialEndsAt: subscription.trialEnd,
      })
    }
  }

  // =============================================================================
  // Cancellation
  // =============================================================================

  /**
   * Cancel a subscription
   */
  async cancel(subscriptionId: string, options?: CancelSubscriptionOptions): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const now = new Date()

    if (options?.atPeriodEnd) {
      subscription.cancelAtPeriodEnd = true
      subscription.cancelAt = subscription.currentPeriodEnd
    } else {
      const previousStatus = subscription.status
      subscription.status = 'canceled'
      subscription.canceledAt = now
      subscription.cancelAtPeriodEnd = false
      subscription.statusHistory.push({ status: 'canceled', timestamp: now })

      // Handle refund
      if (options?.refund === 'prorate') {
        const plan = this.plans.get(subscription.planId)
        if (plan) {
          const periodDays = daysInInterval(plan.interval) * plan.intervalCount
          const daysRemaining = daysBetween(now, subscription.currentPeriodEnd)
          const refundAmount = Math.round((plan.amount * subscription.quantity * daysRemaining) / periodDays)

          if (refundAmount > 0) {
            const refund: Refund = {
              id: generateId('re'),
              subscriptionId,
              amount: refundAmount,
              reason: options?.reason,
              createdAt: now,
            }
            this.refunds.set(refund.id, refund)
            subscription.refundAmount = refundAmount
            subscription.refundId = refund.id
          }
        }
      } else if (options?.refund === 'full') {
        const plan = this.plans.get(subscription.planId)
        if (plan) {
          const refundAmount = plan.amount * subscription.quantity
          const refund: Refund = {
            id: generateId('re'),
            subscriptionId,
            amount: refundAmount,
            reason: options?.reason,
            createdAt: now,
          }
          this.refunds.set(refund.id, refund)
          subscription.refundAmount = refundAmount
          subscription.refundId = refund.id
        }
      } else {
        subscription.refundAmount = 0
      }

      await this.emit('subscription.canceled', {
        subscriptionId,
        previousStatus,
        newStatus: 'canceled',
        cancellationType: 'immediate',
      })
    }

    subscription.cancellationDetails = {
      reason: options?.reason,
      feedback: options?.feedback,
      canceledAt: subscription.status === 'canceled' ? now : undefined,
      effectiveAt: subscription.cancelAt,
    }
    subscription.updatedAt = now

    return subscription
  }

  /**
   * Reactivate a subscription scheduled for cancellation
   */
  async reactivate(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    subscription.cancelAtPeriodEnd = false
    subscription.cancelAt = undefined
    subscription.cancellationDetails = undefined
    subscription.updatedAt = new Date()

    return subscription
  }

  /**
   * Process period end (called by scheduler)
   */
  async processPeriodEnd(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return

    const now = new Date()

    if (subscription.cancelAtPeriodEnd) {
      const previousStatus = subscription.status
      subscription.status = 'canceled'
      subscription.canceledAt = now
      subscription.statusHistory.push({ status: 'canceled', timestamp: now })
      subscription.updatedAt = now

      await this.emit('subscription.canceled', {
        subscriptionId,
        previousStatus,
        newStatus: 'canceled',
        cancellationType: 'at_period_end',
      })
    }
  }

  /**
   * Get refund by ID
   */
  async getRefund(refundId: string): Promise<Refund | null> {
    return this.refunds.get(refundId) ?? null
  }

  // =============================================================================
  // Pause and Resume
  // =============================================================================

  /**
   * Pause a subscription
   */
  async pause(subscriptionId: string, options?: PauseSubscriptionOptions): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    // Check pause limits
    if (options?.pauseDays && subscription.pauseConfig?.maxPauseDays) {
      if (options.pauseDays > subscription.pauseConfig.maxPauseDays) {
        throw new Error('Pause duration exceeds maximum')
      }
    }

    // Check max pauses per year
    if (subscription.pauseConfig?.maxPausesPerYear) {
      const pauseCount = subscription.statusHistory.filter(
        (h) => h.status === 'paused' &&
          h.timestamp.getFullYear() === new Date().getFullYear()
      ).length
      if (pauseCount >= subscription.pauseConfig.maxPausesPerYear) {
        throw new Error('Maximum pauses exceeded for this period')
      }
    }

    const now = new Date()
    const previousStatus = subscription.status

    subscription.status = 'paused'
    subscription.pausedAt = now

    if (options?.resumeAt) {
      subscription.resumeAt = options.resumeAt
    } else if (options?.pauseDays) {
      subscription.resumeAt = new Date(now.getTime() + options.pauseDays * 24 * 60 * 60 * 1000)
    }

    subscription.statusHistory.push({ status: 'paused', timestamp: now })
    subscription.updatedAt = now

    await this.emit('subscription.paused', {
      subscriptionId,
      previousStatus,
      newStatus: 'paused',
    })

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

    const now = new Date()
    const previousStatus = subscription.status

    // Extend billing period by pause duration
    if (subscription.pausedAt) {
      const pauseDuration = now.getTime() - subscription.pausedAt.getTime()
      subscription.currentPeriodEnd = new Date(subscription.currentPeriodEnd.getTime() + pauseDuration)
    }

    subscription.status = 'active'
    subscription.pausedAt = undefined
    subscription.resumeAt = undefined
    subscription.statusHistory.push({ status: 'active', timestamp: now })
    subscription.updatedAt = now

    await this.emit('subscription.resumed', {
      subscriptionId,
      previousStatus,
      newStatus: 'active',
    })

    return subscription
  }

  /**
   * Process scheduled resumes (called by scheduler)
   */
  async processScheduledResumes(asOfDate: Date): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (
        subscription.status === 'paused' &&
        subscription.resumeAt &&
        subscription.resumeAt <= asOfDate
      ) {
        await this.resume(subscription.id)
      }
    }
  }

  // =============================================================================
  // Plan Changes
  // =============================================================================

  /**
   * Change subscription plan
   */
  async changePlan(subscriptionId: string, options: PlanChangeOptions): Promise<PlanChangeResult> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const newPlan = this.plans.get(options.newPlanId)
    if (!newPlan) {
      throw new Error('New plan not found')
    }

    const currentPlan = this.plans.get(subscription.planId)
    if (!currentPlan) {
      throw new Error('Current plan not found')
    }

    const now = new Date()
    let prorationItems: ProrationItem[] = []
    let amountDue = 0
    let creditApplied = 0
    let invoiceId: string | undefined
    let invoiceStatus: 'paid' | 'open' | 'draft' | undefined

    // Handle scheduling at period end
    if (options.effectiveDate === 'period_end') {
      subscription.scheduledPlanChange = {
        planId: options.newPlanId,
        effectiveAt: subscription.currentPeriodEnd,
      }
      subscription.updatedAt = now

      return {
        subscription,
        prorationItems: [],
      }
    }

    // Calculate proration
    if (options.prorationBehavior === 'create_prorations' || options.prorationBehavior === 'always_invoice') {
      const periodDays = daysInInterval(currentPlan.interval) * currentPlan.intervalCount
      const daysRemaining = daysBetween(now, subscription.currentPeriodEnd)

      // Credit for unused portion of current plan
      const unusedCredit = Math.round(
        (currentPlan.amount * subscription.quantity * daysRemaining) / periodDays
      )
      if (unusedCredit > 0) {
        prorationItems.push({
          description: `Unused time on ${currentPlan.name}`,
          amount: -unusedCredit,
          type: 'credit',
          periodStart: now,
          periodEnd: subscription.currentPeriodEnd,
        })
      }

      // Charge for remaining portion of new plan
      const newPeriodDays = daysInInterval(newPlan.interval) * newPlan.intervalCount
      const newCharge = Math.round(
        (newPlan.amount * subscription.quantity * daysRemaining) / newPeriodDays
      )
      if (newCharge > 0) {
        prorationItems.push({
          description: `Remaining time on ${newPlan.name}`,
          amount: newCharge,
          type: 'debit',
          periodStart: now,
          periodEnd: subscription.currentPeriodEnd,
        })
      }

      // Calculate net amount
      const netAmount = prorationItems.reduce((sum, item) => sum + item.amount, 0)
      if (netAmount > 0) {
        amountDue = netAmount
      } else {
        creditApplied = Math.abs(netAmount)
      }

      // Create invoice if always_invoice
      if (options.prorationBehavior === 'always_invoice' && amountDue > 0) {
        const invoice: Invoice = {
          id: generateId('inv'),
          subscriptionId,
          customerId: subscription.customerId,
          amount: amountDue,
          currency: newPlan.currency,
          status: 'paid',
          lineItems: prorationItems.map((p) => ({
            id: generateId('li'),
            description: p.description,
            amount: p.amount,
            quantity: 1,
            type: 'proration',
          })),
          periodStart: now,
          periodEnd: subscription.currentPeriodEnd,
          createdAt: now,
          paidAt: now,
        }
        this.invoices.set(invoice.id, invoice)
        invoiceId = invoice.id
        invoiceStatus = 'paid'
      }
    }

    // Update subscription
    subscription.planId = options.newPlanId
    subscription.currentAmount = newPlan.amount * subscription.quantity
    subscription.items[0] = {
      ...subscription.items[0],
      planId: options.newPlanId,
      updatedAt: now,
    }
    subscription.updatedAt = now

    return {
      subscription,
      prorationItems,
      amountDue: amountDue > 0 ? amountDue : undefined,
      creditApplied: creditApplied > 0 ? creditApplied : undefined,
      invoiceId,
      invoiceStatus,
    }
  }

  /**
   * Preview plan change without applying
   */
  async previewPlanChange(subscriptionId: string, options: PlanChangeOptions): Promise<InvoicePreview> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const newPlan = this.plans.get(options.newPlanId)
    if (!newPlan) {
      throw new Error('New plan not found')
    }

    const currentPlan = this.plans.get(subscription.planId)
    if (!currentPlan) {
      throw new Error('Current plan not found')
    }

    const now = new Date()
    const prorationItems: ProrationItem[] = []

    if (options.prorationBehavior === 'create_prorations') {
      const periodDays = daysInInterval(currentPlan.interval) * currentPlan.intervalCount
      const daysRemaining = daysBetween(now, subscription.currentPeriodEnd)

      // Credit for unused portion of current plan
      const unusedCredit = Math.round(
        (currentPlan.amount * subscription.quantity * daysRemaining) / periodDays
      )
      if (unusedCredit > 0) {
        prorationItems.push({
          description: `Unused time on ${currentPlan.name}`,
          amount: -unusedCredit,
          type: 'credit',
        })
      }

      // Charge for remaining portion of new plan
      const newPeriodDays = daysInInterval(newPlan.interval) * newPlan.intervalCount
      const newCharge = Math.round(
        (newPlan.amount * subscription.quantity * daysRemaining) / newPeriodDays
      )
      if (newCharge > 0) {
        prorationItems.push({
          description: `Remaining time on ${newPlan.name}`,
          amount: newCharge,
          type: 'debit',
        })
      }
    }

    const subtotal = prorationItems.reduce((sum, item) => sum + item.amount, 0)

    return {
      currentPlanId: subscription.planId,
      newPlanId: options.newPlanId,
      prorationItems,
      amountDue: Math.max(0, subtotal),
      subtotal,
      total: subtotal,
    }
  }

  /**
   * Update subscription quantity
   */
  async updateQuantity(subscriptionId: string, options: QuantityUpdateOptions): Promise<PlanChangeResult> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const plan = this.plans.get(subscription.planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    const now = new Date()
    const previousQuantity = subscription.quantity
    let prorationItems: ProrationItem[] = []
    let amountDue = 0

    if (options.prorationBehavior === 'create_prorations') {
      const quantityDelta = options.quantity - previousQuantity
      const periodDays = daysInInterval(plan.interval) * plan.intervalCount
      const daysRemaining = daysBetween(now, subscription.currentPeriodEnd)

      if (quantityDelta > 0) {
        const charge = Math.round((plan.amount * quantityDelta * daysRemaining) / periodDays)
        prorationItems.push({
          description: `Add ${quantityDelta} seats (prorated)`,
          amount: charge,
          type: 'debit',
        })
        amountDue = charge
      } else if (quantityDelta < 0) {
        const credit = Math.round((plan.amount * Math.abs(quantityDelta) * daysRemaining) / periodDays)
        prorationItems.push({
          description: `Remove ${Math.abs(quantityDelta)} seats (prorated)`,
          amount: -credit,
          type: 'credit',
        })
      }
    }

    subscription.quantity = options.quantity
    subscription.currentAmount = plan.amount * options.quantity
    subscription.items[0].quantity = options.quantity
    subscription.updatedAt = now

    return {
      subscription,
      prorationItems,
      amountDue: amountDue > 0 ? amountDue : undefined,
    }
  }

  /**
   * Update billing anchor
   */
  async updateBillingAnchor(subscriptionId: string, options: BillingAnchorUpdateOptions): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    subscription.billingCycleAnchor = options.newAnchor
    subscription.updatedAt = new Date()

    return subscription
  }

  // =============================================================================
  // Access & Billing
  // =============================================================================

  /**
   * Check if subscription has access
   */
  async checkAccess(subscriptionId: string): Promise<AccessCheckResult> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      return { hasAccess: false, reason: 'not_found' }
    }

    switch (subscription.status) {
      case 'active':
        return { hasAccess: true, expiresAt: subscription.currentPeriodEnd }
      case 'trialing':
        return { hasAccess: true, expiresAt: subscription.trialEnd, inTrial: true }
      case 'canceled':
        return { hasAccess: false, reason: 'canceled' }
      case 'paused':
        return { hasAccess: false, reason: 'paused' }
      case 'past_due':
        // Still has access during grace period
        return { hasAccess: true, expiresAt: subscription.currentPeriodEnd }
      default:
        return { hasAccess: false }
    }
  }

  /**
   * Attempt billing for a subscription
   */
  async attemptBilling(subscriptionId: string): Promise<BillingResult> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      return { skipped: true, reason: 'not_found' }
    }

    if (subscription.status === 'trialing') {
      return { skipped: true, reason: 'in_trial' }
    }

    if (subscription.status === 'paused') {
      return { skipped: true, reason: 'subscription_paused' }
    }

    if (subscription.status === 'canceled') {
      return { skipped: true, reason: 'canceled' }
    }

    // Create invoice
    const plan = this.plans.get(subscription.planId)
    if (!plan) {
      return { skipped: true, reason: 'plan_not_found' }
    }

    const invoice: Invoice = {
      id: generateId('inv'),
      subscriptionId,
      customerId: subscription.customerId,
      amount: subscription.currentAmount,
      currency: plan.currency,
      status: 'paid',
      lineItems: [{
        id: generateId('li'),
        description: `${plan.name} x ${subscription.quantity}`,
        amount: subscription.currentAmount,
        quantity: subscription.quantity,
        type: 'subscription',
      }],
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      createdAt: new Date(),
      paidAt: new Date(),
    }
    this.invoices.set(invoice.id, invoice)
    subscription.latestInvoiceId = invoice.id

    return {
      success: true,
      invoiceId: invoice.id,
      amount: invoice.amount,
    }
  }

  /**
   * Get latest invoice for a subscription
   */
  async getLatestInvoice(subscriptionId: string): Promise<Invoice | null> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || !subscription.latestInvoiceId) {
      return null
    }
    return this.invoices.get(subscription.latestInvoiceId) ?? null
  }

  /**
   * Renew a subscription
   */
  async renewSubscription(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) return

    const plan = this.plans.get(subscription.planId)
    if (!plan) return

    const previousPeriodEnd = subscription.currentPeriodEnd

    // Advance billing period
    subscription.currentPeriodStart = subscription.currentPeriodEnd
    subscription.currentPeriodEnd = addInterval(
      subscription.currentPeriodStart,
      plan.interval,
      plan.intervalCount
    )
    subscription.updatedAt = new Date()

    await this.emit('subscription.renewed', {
      subscriptionId,
      previousPeriodEnd,
      newPeriodEnd: subscription.currentPeriodEnd,
    })
  }

  // =============================================================================
  // Usage-Based Billing
  // =============================================================================

  /**
   * Record usage for metered subscription
   */
  async recordUsage(subscriptionId: string, options: RecordUsageOptions): Promise<UsageRecord> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const record: UsageRecord = {
      id: generateId('ur'),
      subscriptionId,
      quantity: options.quantity,
      action: options.action ?? 'increment',
      timestamp: options.timestamp ?? new Date(),
      metadata: options.metadata,
    }

    const records = this.usageRecords.get(subscriptionId) ?? []
    records.push(record)
    this.usageRecords.set(subscriptionId, records)

    return record
  }

  /**
   * Get usage for a subscription
   */
  async getUsage(subscriptionId: string): Promise<UsageSummary> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const records = this.usageRecords.get(subscriptionId) ?? []
    const plan = this.plans.get(subscription.planId)

    let totalQuantity = 0
    for (const record of records) {
      if (record.action === 'set') {
        totalQuantity = record.quantity
      } else {
        totalQuantity += record.quantity
      }
    }

    const unitAmount = plan?.unitAmount ?? 0
    const estimatedAmount = totalQuantity * unitAmount

    return {
      totalQuantity,
      estimatedAmount,
      records,
    }
  }

  /**
   * Bill usage for a subscription
   */
  async billUsage(subscriptionId: string): Promise<Invoice> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      throw new Error('Subscription not found')
    }

    const plan = this.plans.get(subscription.planId)
    if (!plan) {
      throw new Error('Plan not found')
    }

    const usage = await this.getUsage(subscriptionId)

    const invoice: Invoice = {
      id: generateId('inv'),
      subscriptionId,
      customerId: subscription.customerId,
      amount: usage.estimatedAmount,
      currency: plan.currency,
      status: 'paid',
      lineItems: [{
        id: generateId('li'),
        description: `Usage: ${usage.totalQuantity} units`,
        amount: usage.estimatedAmount,
        quantity: usage.totalQuantity,
        type: 'usage',
      }],
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      createdAt: new Date(),
      paidAt: new Date(),
    }
    this.invoices.set(invoice.id, invoice)

    return invoice
  }

  // =============================================================================
  // Dunning
  // =============================================================================

  /**
   * Get dunning history for a subscription
   */
  async getDunningHistory(subscriptionId: string): Promise<DunningHistoryEntry[]> {
    return this.dunningHistory.get(subscriptionId) ?? []
  }

  /**
   * Process scheduled retries (called by scheduler)
   */
  async processScheduledRetries(asOfDate: Date): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (
        subscription.status === 'past_due' &&
        subscription.nextRetryAt &&
        subscription.nextRetryAt <= asOfDate
      ) {
        await this.emit('payment.retry', {
          subscriptionId: subscription.id,
        })
      }
    }
  }

  // =============================================================================
  // Event Handling
  // =============================================================================

  /**
   * Subscribe to events
   */
  on(event: SubscriptionEventType, handler: SubscriptionEventHandler): void {
    const handlers = this.eventHandlers.get(event) ?? []
    handlers.push(handler)
    this.eventHandlers.set(event, handlers)
  }

  /**
   * Emit an event
   */
  private async emit(event: SubscriptionEventType, payload: SubscriptionEventPayload): Promise<void> {
    const handlers = this.eventHandlers.get(event) ?? []
    for (const handler of handlers) {
      try {
        await handler(payload)
      } catch {
        // Ignore handler errors
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new SubscriptionManager instance
 */
export function createSubscriptionManager(): SubscriptionManager {
  return new SubscriptionManager()
}
