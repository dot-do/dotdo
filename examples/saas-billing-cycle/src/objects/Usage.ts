/**
 * UsageDO - Metered Usage Tracking
 *
 * Tracks usage-based billing metrics for a subscription.
 * Each subscription gets its own instance (keyed by subscriptionId).
 *
 * Responsibilities:
 * - Record usage events (API calls, storage, seats)
 * - Aggregate usage by billing period
 * - Calculate overage charges
 * - Provide usage summaries
 *
 * Events Emitted:
 * - Usage.recorded - Usage event stored
 * - Usage.limitWarning - Usage approaching plan limit
 * - Usage.limitExceeded - Usage exceeded plan limit
 * - Usage.summary - Period usage summary
 */

import { DO } from 'dotdo'
import type { Plan } from './Subscription'
import { PLANS } from './Subscription'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type UsageMetric = 'api_calls' | 'storage' | 'seats'

export interface UsageRecord {
  id: string
  subscriptionId: string
  metric: UsageMetric
  quantity: number
  timestamp: Date
  metadata?: Record<string, unknown>
}

export interface PeriodUsage {
  period: string // YYYY-MM format
  subscriptionId: string
  metrics: {
    api_calls: number
    storage: number
    seats: number
  }
  records: UsageRecord[]
  updatedAt: Date
}

export interface UsageSummary {
  period: string
  subscriptionId: string
  planId: string
  usage: {
    api_calls: { used: number; limit: number; overage: number }
    storage: { used: number; limit: number; overage: number }
    seats: { used: number; limit: number; overage: number }
  }
  overageCharges: {
    api_calls: number
    storage: number
    total: number
  }
}

export class UsageError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'UsageError'
  }
}

// ============================================================================
// USAGE DURABLE OBJECT
// ============================================================================

export class UsageDO extends DO {
  static readonly $type = 'UsageDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // INVOICE INTEGRATION
    // ========================================================================

    /**
     * Invoice.requestUsage - Provide usage data for invoice generation
     */
    this.$.on.Invoice.requestUsage(async (event) => {
      const { subscriptionId, period, planId } = event.data as {
        subscriptionId: string
        period: string
        planId: string
        invoiceId: string
      }

      // Only handle our subscription
      if (subscriptionId !== this.ns) return

      console.log(`[Usage] Providing usage for ${subscriptionId} period ${period}`)

      const summary = await this.getSummary(planId, period)

      this.$.send('Usage.summary', {
        subscriptionId,
        period,
        summary,
      })
    })

    // ========================================================================
    // SCHEDULED USAGE CHECKS
    // ========================================================================

    // Check usage limits every hour
    this.$.every.hour(async () => {
      const currentPeriod = this.getCurrentPeriod()
      const periodUsage = await this.getPeriodUsage(currentPeriod)
      if (!periodUsage) return

      // Get subscription info from context (would be set when creating DO)
      const planId = await this.ctx.storage.get<string>('planId')
      if (!planId) return

      const plan = PLANS[planId]
      if (!plan) return

      // Check each metric against limits
      for (const metric of ['api_calls', 'storage', 'seats'] as UsageMetric[]) {
        const used = periodUsage.metrics[metric]
        const limit = plan.limits[metric.replace('_', '') as keyof typeof plan.limits] as number

        if (limit === Infinity) continue

        const percentage = (used / limit) * 100

        // Warn at 80%
        if (percentage >= 80 && percentage < 100) {
          this.$.send('Usage.limitWarning', {
            subscriptionId: this.ns,
            metric,
            used,
            limit,
            percentage: Math.round(percentage),
          })
        }

        // Alert at 100%
        if (percentage >= 100) {
          this.$.send('Usage.limitExceeded', {
            subscriptionId: this.ns,
            metric,
            used,
            limit,
            overage: used - limit,
          })
        }
      }
    })

    console.log('[UsageDO] Event handlers registered')
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Record a usage event.
   */
  async record(
    metric: UsageMetric,
    quantity: number,
    metadata?: Record<string, unknown>
  ): Promise<UsageRecord> {
    if (quantity <= 0) {
      throw new UsageError('Quantity must be positive', 'INVALID_QUANTITY')
    }

    const record: UsageRecord = {
      id: `usg_${crypto.randomUUID().slice(0, 8)}`,
      subscriptionId: this.ns,
      metric,
      quantity,
      timestamp: new Date(),
      metadata,
    }

    // Store in current period
    const period = this.getCurrentPeriod()
    const periodUsage = await this.getOrCreatePeriodUsage(period)

    periodUsage.metrics[metric] += quantity
    periodUsage.records.push(record)
    periodUsage.updatedAt = new Date()

    await this.ctx.storage.put(`usage:${period}`, periodUsage)

    this.$.send('Usage.recorded', {
      subscriptionId: this.ns,
      metric,
      quantity,
      totalForPeriod: periodUsage.metrics[metric],
    })

    // Check if limit exceeded (async, don't block)
    this.checkLimits(metric, periodUsage.metrics[metric])

    return record
  }

  /**
   * Get usage for a specific period.
   */
  async getUsage(period?: string): Promise<PeriodUsage | null> {
    const targetPeriod = period ?? this.getCurrentPeriod()
    return this.getPeriodUsage(targetPeriod)
  }

  /**
   * Get usage summary with overage calculations.
   */
  async getSummary(planId: string, period?: string): Promise<UsageSummary> {
    const targetPeriod = period ?? this.getCurrentPeriod()
    const periodUsage = await this.getOrCreatePeriodUsage(targetPeriod)
    const plan = PLANS[planId]

    if (!plan) {
      throw new UsageError(`Invalid plan: ${planId}`, 'INVALID_PLAN')
    }

    const usage = {
      api_calls: this.calculateMetricUsage(periodUsage.metrics.api_calls, plan.limits.apiCalls),
      storage: this.calculateMetricUsage(periodUsage.metrics.storage, plan.limits.storage),
      seats: this.calculateMetricUsage(periodUsage.metrics.seats, plan.limits.seats),
    }

    const overageCharges = {
      api_calls: this.calculateOverageCharge('api_calls', usage.api_calls.overage, plan),
      storage: this.calculateOverageCharge('storage', usage.storage.overage, plan),
      total: 0,
    }
    overageCharges.total = overageCharges.api_calls + overageCharges.storage

    return {
      period: targetPeriod,
      subscriptionId: this.ns,
      planId,
      usage,
      overageCharges,
    }
  }

  /**
   * Set the plan ID for this subscription (used for limit checking).
   */
  async setPlanId(planId: string): Promise<void> {
    await this.ctx.storage.put('planId', planId)
  }

  /**
   * Reset usage for a new billing period.
   * Called when subscription renews.
   */
  async resetForNewPeriod(): Promise<void> {
    // Archive current period
    const currentPeriod = this.getCurrentPeriod()
    const currentUsage = await this.getPeriodUsage(currentPeriod)

    if (currentUsage) {
      // Keep archived usage for 12 months
      const archiveKey = `archive:${currentPeriod}`
      await this.ctx.storage.put(archiveKey, currentUsage)
    }

    // Note: New period will be created automatically on first record
    console.log(`[Usage] Reset for new period after ${currentPeriod}`)
  }

  /**
   * Get usage history for past N periods.
   */
  async getHistory(months: number = 6): Promise<PeriodUsage[]> {
    const history: PeriodUsage[] = []
    const now = new Date()

    for (let i = 0; i < months; i++) {
      const date = new Date(now)
      date.setMonth(date.getMonth() - i)
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      const usage = await this.getPeriodUsage(period)
      if (usage) {
        history.push(usage)
      }
    }

    return history
  }

  // ==========================================================================
  // INTERNAL METHODS
  // ==========================================================================

  /**
   * Get current billing period in YYYY-MM format.
   */
  private getCurrentPeriod(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  /**
   * Get period usage from storage.
   */
  private async getPeriodUsage(period: string): Promise<PeriodUsage | null> {
    return (await this.ctx.storage.get<PeriodUsage>(`usage:${period}`)) ?? null
  }

  /**
   * Get or create period usage.
   */
  private async getOrCreatePeriodUsage(period: string): Promise<PeriodUsage> {
    let usage = await this.getPeriodUsage(period)

    if (!usage) {
      usage = {
        period,
        subscriptionId: this.ns,
        metrics: {
          api_calls: 0,
          storage: 0,
          seats: 0,
        },
        records: [],
        updatedAt: new Date(),
      }
      await this.ctx.storage.put(`usage:${period}`, usage)
    }

    return usage
  }

  /**
   * Calculate usage vs limit.
   */
  private calculateMetricUsage(
    used: number,
    limit: number
  ): { used: number; limit: number; overage: number } {
    return {
      used,
      limit: limit === Infinity ? -1 : limit, // -1 indicates unlimited
      overage: limit === Infinity ? 0 : Math.max(0, used - limit),
    }
  }

  /**
   * Calculate overage charge for a metric.
   */
  private calculateOverageCharge(metric: UsageMetric, overage: number, plan: Plan): number {
    if (overage <= 0 || !plan.metered) return 0

    switch (metric) {
      case 'api_calls':
        // Price per 1000 calls
        if (plan.metered.apiCalls) {
          return Math.ceil(overage / 1000) * plan.metered.apiCalls
        }
        break
      case 'storage':
        // Price per GB
        if (plan.metered.storage) {
          return overage * plan.metered.storage
        }
        break
    }

    return 0
  }

  /**
   * Check if usage exceeds limits and emit events.
   */
  private async checkLimits(metric: UsageMetric, currentUsage: number): Promise<void> {
    const planId = await this.ctx.storage.get<string>('planId')
    if (!planId) return

    const plan = PLANS[planId]
    if (!plan) return

    const limitKey = metric === 'api_calls' ? 'apiCalls' : metric
    const limit = plan.limits[limitKey as keyof typeof plan.limits] as number

    if (limit === Infinity) return

    const percentage = (currentUsage / limit) * 100

    if (percentage >= 100) {
      this.$.send('Usage.limitExceeded', {
        subscriptionId: this.ns,
        metric,
        used: currentUsage,
        limit,
        overage: currentUsage - limit,
      })

      this.$.send('Customer.notify', {
        customerId: this.ns, // Assuming subscriptionId matches customerId
        type: 'usage_limit_exceeded',
        data: { metric, used: currentUsage, limit },
      })
    } else if (percentage >= 80) {
      // Only warn once per threshold crossing
      const warningKey = `warning:${metric}:${this.getCurrentPeriod()}`
      const alreadyWarned = await this.ctx.storage.get<boolean>(warningKey)

      if (!alreadyWarned) {
        await this.ctx.storage.put(warningKey, true)

        this.$.send('Usage.limitWarning', {
          subscriptionId: this.ns,
          metric,
          used: currentUsage,
          limit,
          percentage: Math.round(percentage),
        })

        this.$.send('Customer.notify', {
          customerId: this.ns,
          type: 'usage_limit_warning',
          data: { metric, used: currentUsage, limit, percentage: Math.round(percentage) },
        })
      }
    }
  }
}
