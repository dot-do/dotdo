/**
 * SubscriptionDO - Per-Customer Subscription Management
 *
 * Manages the complete subscription lifecycle for a single customer.
 * Each customer gets their own instance (keyed by customerId).
 *
 * Responsibilities:
 * - Create and manage subscriptions
 * - Handle plan changes (upgrade/downgrade)
 * - Process trial periods
 * - Coordinate with Invoice/Payment DOs
 *
 * Lifecycle:
 * trial -> active -> past_due -> suspended -> cancelled -> ended
 *        |-> active (trial converts)
 *
 * Events Emitted:
 * - Subscription.created - New subscription started
 * - Subscription.upgraded - Plan upgraded (immediate)
 * - Subscription.downgraded - Plan downgraded (at period end)
 * - Subscription.cancelled - Cancellation requested
 * - Subscription.suspended - Suspended due to payment failure
 * - Subscription.renewed - New billing period started
 * - Subscription.ended - Subscription terminated
 * - Invoice.generate - Request invoice generation
 * - Customer.notify - Send customer notification
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'ended'

export interface Plan {
  id: string
  name: string
  price: number // Monthly price in cents
  currency: string
  interval: 'month' | 'year'
  features: string[]
  limits: {
    apiCalls: number
    storage: number // GB
    seats: number
  }
  metered?: {
    apiCalls?: number // Price per 1000 calls over limit
    storage?: number // Price per GB over limit
  }
}

export interface Subscription {
  id: string
  customerId: string
  planId: string
  status: SubscriptionStatus
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  trialEnd?: Date
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface PendingDowngrade {
  toPlanId: string
  effectiveDate: Date
}

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'SubscriptionError'
  }
}

// ============================================================================
// PLAN CATALOG
// ============================================================================

export const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    interval: 'month',
    features: ['basic_api', 'community_support'],
    limits: { apiCalls: 1000, storage: 1, seats: 1 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 4900, // $49/month
    currency: 'USD',
    interval: 'month',
    features: ['basic_api', 'analytics', 'priority_support', 'webhooks'],
    limits: { apiCalls: 50000, storage: 10, seats: 5 },
    metered: { apiCalls: 50, storage: 100 }, // $0.50/1k calls, $1/GB
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 29900, // $299/month
    currency: 'USD',
    interval: 'month',
    features: ['basic_api', 'analytics', 'priority_support', 'webhooks', 'sso', 'dedicated_support', 'sla'],
    limits: { apiCalls: Infinity, storage: 100, seats: Infinity },
    metered: { storage: 50 }, // $0.50/GB over limit
  },
}

// ============================================================================
// SUBSCRIPTION DURABLE OBJECT
// ============================================================================

export class SubscriptionDO extends DO {
  static readonly $type = 'SubscriptionDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // PAYMENT RESPONSE HANDLERS
    // ========================================================================

    /**
     * Payment.succeeded - Invoice paid, renew subscription
     */
    this.$.on.Payment.succeeded(async (event) => {
      const { subscriptionId, invoiceId } = event.data as {
        subscriptionId: string
        invoiceId: string
      }

      const subscription = await this.getSubscription()
      if (!subscription || subscription.id !== subscriptionId) return

      console.log(`[Subscription] Payment succeeded for ${subscriptionId}`)

      // Reactivate if was past_due
      if (subscription.status === 'past_due') {
        subscription.status = 'active'
        await this.saveSubscription(subscription)

        this.$.send('Customer.notify', {
          customerId: subscription.customerId,
          type: 'subscription_reactivated',
          data: { subscriptionId },
        })
      }

      // Trigger renewal
      await this.renew(subscriptionId)
    })

    /**
     * Payment.failed - Update status to past_due
     */
    this.$.on.Payment.failed(async (event) => {
      const { subscriptionId, attemptCount, exhausted } = event.data as {
        subscriptionId: string
        invoiceId: string
        attemptCount: number
        exhausted: boolean
      }

      const subscription = await this.getSubscription()
      if (!subscription || subscription.id !== subscriptionId) return

      console.log(`[Subscription] Payment failed for ${subscriptionId} (attempt ${attemptCount})`)

      if (exhausted) {
        // All retries exhausted - suspend
        subscription.status = 'suspended'
        await this.saveSubscription(subscription)

        this.$.send('Subscription.suspended', {
          subscriptionId,
          customerId: subscription.customerId,
          reason: 'Payment failed after multiple attempts',
        })

        this.$.send('Customer.notify', {
          customerId: subscription.customerId,
          type: 'subscription_suspended',
          data: { subscriptionId, reason: 'payment_failed' },
        })
      } else {
        // Mark as past_due if not already
        if (subscription.status === 'active') {
          subscription.status = 'past_due'
          await this.saveSubscription(subscription)
        }
      }
    })

    /**
     * Trial.ending - Send trial ending notification
     */
    this.$.on.Trial.ending(async (event) => {
      const { subscriptionId, daysRemaining } = event.data as {
        subscriptionId: string
        daysRemaining: number
      }

      const subscription = await this.getSubscription()
      if (!subscription || subscription.id !== subscriptionId) return

      this.$.send('Customer.notify', {
        customerId: subscription.customerId,
        type: 'trial_ending',
        data: { subscriptionId, daysRemaining, trialEnd: subscription.trialEnd },
      })
    })

    // ========================================================================
    // SCHEDULED BILLING
    // ========================================================================

    // Check for period end daily at midnight
    this.$.every.day.atmidnight(async () => {
      const subscription = await this.getSubscription()
      if (!subscription) return

      const now = new Date()

      // Check for trial ending (3 days before)
      if (subscription.status === 'trialing' && subscription.trialEnd) {
        const trialEnd = new Date(subscription.trialEnd)
        const daysUntilEnd = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        if (daysUntilEnd === 3) {
          this.$.send('Trial.ending', {
            subscriptionId: subscription.id,
            daysRemaining: 3,
          })
        }

        // Convert trial to active
        if (now >= trialEnd) {
          subscription.status = 'active'
          await this.saveSubscription(subscription)

          // Generate first invoice
          const plan = PLANS[subscription.planId]
          if (plan.price > 0) {
            this.$.send('Invoice.generate', {
              subscriptionId: subscription.id,
              customerId: subscription.customerId,
              planId: subscription.planId,
              periodStart: subscription.currentPeriodStart,
              periodEnd: subscription.currentPeriodEnd,
            })
          }
        }
      }

      // Check for period end
      const periodEnd = new Date(subscription.currentPeriodEnd)
      if (now >= periodEnd && subscription.status === 'active') {
        // Check for pending downgrade
        const pendingDowngrade = await this.ctx.storage.get<PendingDowngrade>('pending_downgrade')
        if (pendingDowngrade) {
          subscription.planId = pendingDowngrade.toPlanId
          await this.ctx.storage.delete('pending_downgrade')
        }

        // Check if should end
        if (subscription.cancelAtPeriodEnd) {
          subscription.status = 'ended'
          await this.saveSubscription(subscription)

          this.$.send('Subscription.ended', {
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
          })
          return
        }

        // Start new period
        subscription.currentPeriodStart = periodEnd
        subscription.currentPeriodEnd = this.addMonths(periodEnd, 1)
        await this.saveSubscription(subscription)

        // Generate invoice for new period
        const plan = PLANS[subscription.planId]
        if (plan.price > 0) {
          this.$.send('Invoice.generate', {
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            planId: subscription.planId,
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
          })
        }
      }
    })

    console.log('[SubscriptionDO] Event handlers registered')
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Create a new subscription.
   */
  async create(
    customerId: string,
    planId: string,
    options?: { trialDays?: number }
  ): Promise<Subscription> {
    // Check for existing active subscription
    const existing = await this.getSubscription()
    if (existing && !['cancelled', 'ended'].includes(existing.status)) {
      throw new SubscriptionError(
        'Customer already has an active subscription',
        'SUBSCRIPTION_EXISTS',
        { existingId: existing.id }
      )
    }

    const plan = PLANS[planId]
    if (!plan) {
      throw new SubscriptionError(`Invalid plan: ${planId}`, 'INVALID_PLAN')
    }

    const now = new Date()
    const subscription: Subscription = {
      id: `sub_${crypto.randomUUID().slice(0, 8)}`,
      customerId,
      planId,
      status: options?.trialDays ? 'trialing' : 'active',
      currentPeriodStart: now,
      currentPeriodEnd: this.addMonths(now, 1),
      cancelAtPeriodEnd: false,
      trialEnd: options?.trialDays ? this.addDays(now, options.trialDays) : undefined,
      createdAt: now,
      updatedAt: now,
    }

    await this.saveSubscription(subscription)

    this.$.send('Subscription.created', {
      subscriptionId: subscription.id,
      customerId,
      planId,
      status: subscription.status,
      trialEnd: subscription.trialEnd,
    })

    // Generate initial invoice if not free and not trial
    if (plan.price > 0 && subscription.status === 'active') {
      this.$.send('Invoice.generate', {
        subscriptionId: subscription.id,
        customerId,
        planId,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      })
    }

    this.$.send('Customer.notify', {
      customerId,
      type: 'subscription_created',
      data: { subscriptionId: subscription.id, planName: plan.name, trialDays: options?.trialDays },
    })

    return subscription
  }

  /**
   * Change subscription plan.
   */
  async changePlan(
    newPlanId: string,
    options?: { immediate?: boolean }
  ): Promise<{ prorationAmount?: number; effectiveDate: Date }> {
    const subscription = await this.getSubscription()
    if (!subscription) {
      throw new SubscriptionError('No active subscription', 'NO_SUBSCRIPTION')
    }

    if (!['active', 'trialing'].includes(subscription.status)) {
      throw new SubscriptionError(
        `Cannot change plan while ${subscription.status}`,
        'INVALID_STATE'
      )
    }

    const oldPlan = PLANS[subscription.planId]
    const newPlan = PLANS[newPlanId]
    if (!newPlan) {
      throw new SubscriptionError(`Invalid plan: ${newPlanId}`, 'INVALID_PLAN')
    }

    const isUpgrade = newPlan.price > oldPlan.price
    const immediate = options?.immediate ?? isUpgrade // Upgrades immediate by default

    if (isUpgrade && immediate) {
      // Calculate proration
      const prorationAmount = this.calculateProration(subscription, oldPlan, newPlan)

      // Update subscription immediately
      const oldPlanId = subscription.planId
      subscription.planId = newPlanId
      subscription.updatedAt = new Date()
      await this.saveSubscription(subscription)

      this.$.send('Subscription.upgraded', {
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        fromPlanId: oldPlanId,
        toPlanId: newPlanId,
        prorationAmount,
      })

      // Generate proration invoice if amount > 0
      if (prorationAmount > 0) {
        this.$.send('Invoice.generateProration', {
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          amount: prorationAmount,
          description: `Proration for upgrade to ${newPlan.name}`,
        })
      }

      this.$.send('Customer.notify', {
        customerId: subscription.customerId,
        type: 'subscription_upgraded',
        data: { fromPlan: oldPlan.name, toPlan: newPlan.name, prorationAmount },
      })

      return { prorationAmount, effectiveDate: new Date() }
    } else {
      // Downgrade takes effect at next billing cycle
      const effectiveDate = new Date(subscription.currentPeriodEnd)

      await this.ctx.storage.put<PendingDowngrade>('pending_downgrade', {
        toPlanId: newPlanId,
        effectiveDate,
      })

      this.$.send('Subscription.downgraded', {
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        fromPlanId: subscription.planId,
        toPlanId: newPlanId,
        effectiveDate,
      })

      this.$.send('Customer.notify', {
        customerId: subscription.customerId,
        type: 'subscription_downgraded',
        data: { fromPlan: oldPlan.name, toPlan: newPlan.name, effectiveDate },
      })

      return { effectiveDate }
    }
  }

  /**
   * Cancel subscription.
   */
  async cancel(options?: { atPeriodEnd?: boolean; reason?: string }): Promise<void> {
    const subscription = await this.getSubscription()
    if (!subscription) {
      throw new SubscriptionError('No active subscription', 'NO_SUBSCRIPTION')
    }

    if (['cancelled', 'ended'].includes(subscription.status)) {
      throw new SubscriptionError('Subscription already cancelled', 'ALREADY_CANCELLED')
    }

    const atPeriodEnd = options?.atPeriodEnd ?? true

    if (atPeriodEnd) {
      subscription.cancelAtPeriodEnd = true
      subscription.updatedAt = new Date()
    } else {
      subscription.status = 'cancelled'
      subscription.cancelAtPeriodEnd = false
      subscription.updatedAt = new Date()
    }

    await this.saveSubscription(subscription)

    this.$.send('Subscription.cancelled', {
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      atPeriodEnd,
      reason: options?.reason,
      effectiveDate: atPeriodEnd ? subscription.currentPeriodEnd : new Date(),
    })

    this.$.send('Customer.notify', {
      customerId: subscription.customerId,
      type: 'subscription_cancelled',
      data: {
        subscriptionId: subscription.id,
        atPeriodEnd,
        effectiveDate: atPeriodEnd ? subscription.currentPeriodEnd : new Date(),
        reason: options?.reason,
      },
    })
  }

  /**
   * Reactivate a cancelled/suspended subscription.
   */
  async reactivate(): Promise<void> {
    const subscription = await this.getSubscription()
    if (!subscription) {
      throw new SubscriptionError('No subscription found', 'NO_SUBSCRIPTION')
    }

    if (subscription.status === 'ended') {
      throw new SubscriptionError('Cannot reactivate ended subscription', 'CANNOT_REACTIVATE')
    }

    subscription.status = 'active'
    subscription.cancelAtPeriodEnd = false
    subscription.updatedAt = new Date()
    await this.saveSubscription(subscription)

    this.$.send('Customer.notify', {
      customerId: subscription.customerId,
      type: 'subscription_reactivated',
      data: { subscriptionId: subscription.id },
    })
  }

  /**
   * Get current subscription.
   */
  async getSubscription(): Promise<Subscription | null> {
    return (await this.ctx.storage.get<Subscription>('subscription')) ?? null
  }

  /**
   * Get all available plans.
   */
  getPlans(): Plan[] {
    return Object.values(PLANS)
  }

  /**
   * Get plan by ID.
   */
  getPlan(planId: string): Plan | null {
    return PLANS[planId] ?? null
  }

  // ==========================================================================
  // INTERNAL METHODS
  // ==========================================================================

  /**
   * Renew subscription for new period.
   */
  private async renew(subscriptionId: string): Promise<void> {
    const subscription = await this.getSubscription()
    if (!subscription || subscription.id !== subscriptionId) return

    this.$.send('Subscription.renewed', {
      subscriptionId,
      customerId: subscription.customerId,
      newPeriodStart: subscription.currentPeriodStart,
      newPeriodEnd: subscription.currentPeriodEnd,
    })
  }

  /**
   * Save subscription to storage.
   */
  private async saveSubscription(subscription: Subscription): Promise<void> {
    await this.ctx.storage.put('subscription', subscription)
  }

  /**
   * Calculate proration for mid-cycle plan change.
   */
  private calculateProration(subscription: Subscription, oldPlan: Plan, newPlan: Plan): number {
    const now = new Date()
    const periodStart = new Date(subscription.currentPeriodStart)
    const periodEnd = new Date(subscription.currentPeriodEnd)

    const totalDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))
    const daysRemaining = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    // Credit for unused time on old plan
    const credit = Math.round((oldPlan.price * daysRemaining) / totalDays)

    // Charge for remaining time on new plan
    const charge = Math.round((newPlan.price * daysRemaining) / totalDays)

    return Math.max(0, charge - credit)
  }

  /**
   * Add months to a date.
   */
  private addMonths(date: Date, months: number): Date {
    const result = new Date(date)
    result.setMonth(result.getMonth() + months)
    return result
  }

  /**
   * Add days to a date.
   */
  private addDays(date: Date, days: number): Date {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
  }
}
