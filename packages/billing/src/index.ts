/**
 * @dotdo/billing v4 - Events → Invoices pipeline
 * Consumes events, applies business models, produces invoices
 */

import type {
  OrgId,
  SubscriptionId,
  InvoiceId,
  Subscription,
  Invoice,
  LineItem,
  Period,
  Entitlement,
  EntitlementCheck,
  Event,
} from '@dotdo/types'
import type { BusinessModel, PlanTier } from '@dotdo/models'

// ============================================================================
// Billing Service
// ============================================================================

export interface BillingServiceOptions {
  /** Stripe API key */
  stripeApiKey?: string
  /** Organization ID */
  orgId: OrgId
}

export class BillingService {
  private orgId: OrgId
  private stripeApiKey?: string

  constructor(options: BillingServiceOptions) {
    this.orgId = options.orgId
    this.stripeApiKey = options.stripeApiKey
  }

  /**
   * Create a subscription
   */
  async createSubscription(input: {
    planId: string
    paymentMethodId?: string
    trialDays?: number
  }): Promise<Subscription> {
    // Implementation would create Stripe subscription
    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    return {
      id: crypto.randomUUID() as SubscriptionId,
      orgId: this.orgId,
      modelId: 'default',
      planId: input.planId,
      status: input.trialDays ? 'trialing' : 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEnd: input.trialDays ? new Date(now.getTime() + input.trialDays * 86400000) : undefined,
    }
  }

  /**
   * Get current subscription
   */
  async getSubscription(): Promise<Subscription | null> {
    // Would query from storage
    return null
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId: SubscriptionId, atPeriodEnd = true): Promise<Subscription> {
    // Would update Stripe subscription
    throw new Error('Not implemented')
  }

  /**
   * Generate invoice from usage
   */
  async generateInvoice(period: Period, model: BusinessModel): Promise<Invoice> {
    // Would aggregate usage events and apply pricing
    throw new Error('Not implemented')
  }
}

// ============================================================================
// Meter Service (Usage Aggregation)
// ============================================================================

export interface MeterServiceOptions {
  orgId: OrgId
  sql: SqlStorage
}

export class MeterService {
  private orgId: OrgId
  private sql: SqlStorage

  constructor(options: MeterServiceOptions) {
    this.orgId = options.orgId
    this.sql = options.sql
  }

  /**
   * Initialize schema
   */
  async init(): Promise<void> {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        timestamp TEXT NOT NULL,
        event_id TEXT,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_usage_metric_ts ON usage_events(metric, timestamp);
    `)
  }

  /**
   * Record usage from event
   */
  async record(event: Event): Promise<void> {
    const usageData = event.data as { metric?: string; value?: number }
    if (!usageData.metric || usageData.value === undefined) return

    this.sql.exec(
      `INSERT INTO usage_events (id, metric, value, timestamp, event_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      usageData.metric,
      usageData.value,
      event.timestamp.toISOString(),
      event.id,
      JSON.stringify(event.metadata ?? {})
    )
  }

  /**
   * Get aggregated usage for a metric
   */
  async getUsage(metric: string, period: Period): Promise<number> {
    const cursor = this.sql.exec(
      `SELECT SUM(value) as total FROM usage_events
       WHERE metric = ? AND timestamp >= ? AND timestamp < ?`,
      metric,
      period.start.toISOString(),
      period.end.toISOString()
    )
    const row = [...cursor][0] as { total: number } | undefined
    return row?.total ?? 0
  }

  /**
   * Get all usage for a period
   */
  async getAllUsage(period: Period): Promise<Record<string, number>> {
    const cursor = this.sql.exec(
      `SELECT metric, SUM(value) as total FROM usage_events
       WHERE timestamp >= ? AND timestamp < ?
       GROUP BY metric`,
      period.start.toISOString(),
      period.end.toISOString()
    )
    const result: Record<string, number> = {}
    for (const row of cursor) {
      const r = row as { metric: string; total: number }
      result[r.metric] = r.total
    }
    return result
  }
}

// ============================================================================
// Entitlement Service
// ============================================================================

export interface EntitlementServiceOptions {
  orgId: OrgId
  sql: SqlStorage
  meterService: MeterService
}

export class EntitlementService {
  private orgId: OrgId
  private sql: SqlStorage
  private meterService: MeterService
  private plan?: PlanTier

  constructor(options: EntitlementServiceOptions) {
    this.orgId = options.orgId
    this.sql = options.sql
    this.meterService = options.meterService
  }

  /**
   * Set the current plan
   */
  setPlan(plan: PlanTier): void {
    this.plan = plan
  }

  /**
   * Check if feature is enabled
   */
  checkFeature(feature: string): boolean {
    if (!this.plan) return false
    return this.plan.features.includes(feature)
  }

  /**
   * Check usage limit
   */
  async checkLimit(metric: string): Promise<EntitlementCheck> {
    if (!this.plan) {
      return { allowed: false, reason: 'No plan configured' }
    }

    const limit = this.plan.limits[metric]
    if (limit === undefined || limit === -1) {
      // No limit or unlimited
      return { allowed: true }
    }

    const period = this.getCurrentBillingPeriod()
    const usage = await this.meterService.getUsage(metric, period)

    if (usage >= limit) {
      // Check for overage pricing
      if (this.plan.overageRates?.[metric]) {
        return {
          allowed: true,
          reason: 'Over limit, overage rates apply',
          usage,
          limit,
        }
      }
      return {
        allowed: false,
        reason: `Limit exceeded: ${usage}/${limit} ${metric}`,
        usage,
        limit,
      }
    }

    return { allowed: true, usage, limit }
  }

  /**
   * Enforce limit (throws if not allowed)
   */
  async enforceLimit(metric: string): Promise<void> {
    const check = await this.checkLimit(metric)
    if (!check.allowed) {
      throw new EntitlementError(check.reason ?? 'Limit exceeded', { metric, ...check })
    }
  }

  /**
   * Get all entitlements for current plan
   */
  getEntitlements(): Entitlement[] {
    if (!this.plan) return []

    const entitlements: Entitlement[] = this.plan.features.map((f) => ({
      feature: f,
      enabled: true,
    }))

    for (const [metric, limit] of Object.entries(this.plan.limits)) {
      entitlements.push({
        feature: metric,
        enabled: true,
        limit: limit === -1 ? undefined : limit,
      })
    }

    return entitlements
  }

  private getCurrentBillingPeriod(): Period {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { start, end }
  }
}

export class EntitlementError extends Error {
  constructor(
    message: string,
    public details: Record<string, unknown>
  ) {
    super(message)
    this.name = 'EntitlementError'
  }
}

// ============================================================================
// Invoice Generator
// ============================================================================

export interface InvoiceGeneratorOptions {
  orgId: OrgId
  meterService: MeterService
}

export class InvoiceGenerator {
  private orgId: OrgId
  private meterService: MeterService

  constructor(options: InvoiceGeneratorOptions) {
    this.orgId = options.orgId
    this.meterService = options.meterService
  }

  /**
   * Generate invoice for a period using a business model
   */
  async generate(period: Period, model: BusinessModel, subscription: Subscription): Promise<Invoice> {
    const usage = await this.meterService.getAllUsage(period)
    const lineItems = this.calculateLineItems(usage, model)

    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
    const tax = 0 // Would calculate based on region

    return {
      id: crypto.randomUUID() as InvoiceId,
      orgId: this.orgId,
      subscriptionId: subscription.id,
      period,
      lineItems,
      subtotal,
      tax,
      total: subtotal + tax,
      status: 'draft',
    }
  }

  private calculateLineItems(usage: Record<string, number>, model: BusinessModel): LineItem[] {
    const lineItems: LineItem[] = []
    const pricing = model.pricing

    // Find the plan tier if SaaS
    const tier = pricing.tiers?.[0] // Simplified - would look up actual tier

    // Base subscription
    if (tier) {
      lineItems.push({
        description: `${tier.name} Plan`,
        quantity: 1,
        unitPrice: tier.price,
        amount: tier.price,
      })
    }

    // Usage-based items
    for (const [metric, value] of Object.entries(usage)) {
      const limit = tier?.limits[metric] ?? 0
      const overage = Math.max(0, value - limit)

      if (overage > 0 && tier?.overageRates?.[metric]) {
        const rate = tier.overageRates[metric]
        const amount = Math.round(overage * rate * 100) // cents

        lineItems.push({
          description: `${metric} overage (${overage} units)`,
          metric,
          quantity: overage,
          unitPrice: rate * 100,
          amount,
        })
      }
    }

    return lineItems
  }
}

// ============================================================================
// Billing Middleware (for .do services)
// ============================================================================

import { MiddlewareHandler } from 'hono'

export interface BillingMiddlewareOptions {
  entitlementService: EntitlementService
  meterService: MeterService
}

export function createBillingMiddleware(options: BillingMiddlewareOptions) {
  return {
    /**
     * Meter usage for a request
     */
    meter(metric: string): MiddlewareHandler {
      return async (c, next) => {
        await next()

        // Record usage after successful response
        if (c.res.status < 400) {
          await options.meterService.record({
            id: crypto.randomUUID() as any,
            type: 'usage.recorded',
            timestamp: new Date(),
            data: { metric, value: 1 },
          })
        }
      }
    },

    /**
     * Check limit before processing
     */
    checkLimit(metric: string): MiddlewareHandler {
      return async (c, next) => {
        const check = await options.entitlementService.checkLimit(metric)

        if (!check.allowed) {
          return c.json(
            {
              error: 'Limit exceeded',
              message: check.reason,
              usage: check.usage,
              limit: check.limit,
            },
            429
          )
        }

        await next()
      }
    },

    /**
     * Check feature access
     */
    checkFeature(feature: string): MiddlewareHandler {
      return async (c, next) => {
        const allowed = options.entitlementService.checkFeature(feature)

        if (!allowed) {
          return c.json(
            {
              error: 'Feature not available',
              message: `Upgrade your plan to access ${feature}`,
            },
            403
          )
        }

        await next()
      }
    },
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  OrgId,
  SubscriptionId,
  InvoiceId,
  Subscription,
  Invoice,
  LineItem,
  Period,
  Entitlement,
  EntitlementCheck,
  SubscriptionStatus,
  InvoiceStatus,
} from '@dotdo/types'
