/**
 * SaaS - Software-as-a-Service application
 *
 * Combines App with subscription billing, multi-tenancy, usage tracking.
 * Examples: 'analytics-saas', 'crm-platform'
 */

import { App, AppConfig } from './App'
import { Env } from './DO'

export interface SaaSPlan {
  id: string
  name: string
  price: number
  interval: 'monthly' | 'yearly'
  features: string[]
  limits: Record<string, number>
}

export interface SaaSSubscription {
  id: string
  planId: string
  customerId: string
  status: 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  canceledAt?: Date
}

export interface UsageRecord {
  id: string
  subscriptionId: string
  metric: string
  quantity: number
  timestamp: Date
}

export interface SaaSConfig extends AppConfig {
  plans: SaaSPlan[]
  trialDays?: number
  features: string[]
  usageMetrics?: string[]
}

export class SaaS extends App {
  private saasConfig: SaaSConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get SaaS configuration
   */
  async getSaaSConfig(): Promise<SaaSConfig | null> {
    if (!this.saasConfig) {
      this.saasConfig = (await this.ctx.storage.get('saas_config')) as SaaSConfig | null
    }
    return this.saasConfig
  }

  /**
   * Configure the SaaS
   */
  async configureSaaS(config: SaaSConfig): Promise<void> {
    this.saasConfig = config
    await this.ctx.storage.put('saas_config', config)
    await this.setConfig(config)
    await this.emit('saas.configured', { config })
  }

  /**
   * Create a subscription
   */
  async createSubscription(customerId: string, planId: string, trial: boolean = false): Promise<SaaSSubscription> {
    const config = await this.getSaaSConfig()
    if (!config) throw new Error('SaaS not configured')

    const plan = config.plans.find((p) => p.id === planId)
    if (!plan) throw new Error(`Plan not found: ${planId}`)

    const now = new Date()
    const periodEnd = new Date(now)

    if (trial && config.trialDays) {
      periodEnd.setDate(periodEnd.getDate() + config.trialDays)
    } else if (plan.interval === 'monthly') {
      periodEnd.setMonth(periodEnd.getMonth() + 1)
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1)
    }

    const subscription: SaaSSubscription = {
      id: crypto.randomUUID(),
      planId,
      customerId,
      status: trial ? 'trialing' : 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    }

    await this.ctx.storage.put(`subscription:${subscription.id}`, subscription)
    await this.emit('subscription.created', { subscription })

    return subscription
  }

  /**
   * Get subscription
   */
  async getSubscription(subscriptionId: string): Promise<SaaSSubscription | null> {
    return (await this.ctx.storage.get(`subscription:${subscriptionId}`)) as SaaSSubscription | null
  }

  /**
   * Get customer's subscription
   */
  async getCustomerSubscription(customerId: string): Promise<SaaSSubscription | null> {
    const map = await this.ctx.storage.list({ prefix: 'subscription:' })
    const subscriptions = Array.from(map.values()) as SaaSSubscription[]
    return subscriptions.find((s) => s.customerId === customerId && s.status !== 'canceled') || null
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId: string): Promise<SaaSSubscription | null> {
    const subscription = await this.getSubscription(subscriptionId)
    if (!subscription) return null

    subscription.status = 'canceled'
    subscription.canceledAt = new Date()

    await this.ctx.storage.put(`subscription:${subscriptionId}`, subscription)
    await this.emit('subscription.canceled', { subscription })

    return subscription
  }

  /**
   * Change subscription plan
   */
  async changePlan(subscriptionId: string, newPlanId: string): Promise<SaaSSubscription | null> {
    const config = await this.getSaaSConfig()
    if (!config) throw new Error('SaaS not configured')

    const plan = config.plans.find((p) => p.id === newPlanId)
    if (!plan) throw new Error(`Plan not found: ${newPlanId}`)

    const subscription = await this.getSubscription(subscriptionId)
    if (!subscription) return null

    const oldPlanId = subscription.planId
    subscription.planId = newPlanId

    await this.ctx.storage.put(`subscription:${subscriptionId}`, subscription)
    await this.emit('subscription.planChanged', { subscriptionId, oldPlanId, newPlanId })

    return subscription
  }

  /**
   * Record usage
   */
  async recordUsage(subscriptionId: string, metric: string, quantity: number): Promise<UsageRecord> {
    const record: UsageRecord = {
      id: crypto.randomUUID(),
      subscriptionId,
      metric,
      quantity,
      timestamp: new Date(),
    }

    await this.ctx.storage.put(`usage:${record.id}`, record)
    await this.emit('usage.recorded', { record })

    return record
  }

  /**
   * Get usage for subscription
   */
  async getUsage(subscriptionId: string, metric?: string, since?: Date): Promise<{ metric: string; total: number }[]> {
    const map = await this.ctx.storage.list({ prefix: 'usage:' })
    let records = Array.from(map.values()) as UsageRecord[]

    records = records.filter((r) => r.subscriptionId === subscriptionId)

    if (metric) {
      records = records.filter((r) => r.metric === metric)
    }

    if (since) {
      records = records.filter((r) => r.timestamp >= since)
    }

    // Aggregate by metric
    const totals: Record<string, number> = {}
    for (const record of records) {
      totals[record.metric] = (totals[record.metric] || 0) + record.quantity
    }

    return Object.entries(totals).map(([metric, total]) => ({ metric, total }))
  }

  /**
   * Check if feature is available for subscription
   */
  async hasFeature(subscriptionId: string, feature: string): Promise<boolean> {
    const config = await this.getSaaSConfig()
    if (!config) return false

    const subscription = await this.getSubscription(subscriptionId)
    if (!subscription || subscription.status === 'canceled') return false

    const plan = config.plans.find((p) => p.id === subscription.planId)
    if (!plan) return false

    return plan.features.includes(feature)
  }

  /**
   * Check usage limit
   */
  async checkLimit(subscriptionId: string, metric: string): Promise<{ allowed: boolean; used: number; limit: number }> {
    const config = await this.getSaaSConfig()
    if (!config) throw new Error('SaaS not configured')

    const subscription = await this.getSubscription(subscriptionId)
    if (!subscription) throw new Error(`Subscription not found: ${subscriptionId}`)

    const plan = config.plans.find((p) => p.id === subscription.planId)
    if (!plan) throw new Error(`Plan not found: ${subscription.planId}`)

    const limit = plan.limits[metric] || Infinity
    const usage = await this.getUsage(subscriptionId, metric, subscription.currentPeriodStart)
    const used = usage[0]?.total || 0

    return {
      allowed: used < limit,
      used,
      limit,
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/saas/config') {
      if (request.method === 'GET') {
        const config = await this.getSaaSConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as SaaSConfig
        await this.configureSaaS(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/saas/plans') {
      const config = await this.getSaaSConfig()
      return new Response(JSON.stringify(config?.plans || []), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/saas/subscribe' && request.method === 'POST') {
      const { customerId, planId, trial } = (await request.json()) as {
        customerId: string
        planId: string
        trial?: boolean
      }
      const subscription = await this.createSubscription(customerId, planId, trial)
      return new Response(JSON.stringify(subscription), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/saas/usage' && request.method === 'POST') {
      const { subscriptionId, metric, quantity } = (await request.json()) as {
        subscriptionId: string
        metric: string
        quantity: number
      }
      const record = await this.recordUsage(subscriptionId, metric, quantity)
      return new Response(JSON.stringify(record), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/saas/subscription/')) {
      const subscriptionId = url.pathname.split('/')[3]
      const subscription = await this.getSubscription(subscriptionId)
      if (!subscription) {
        return new Response('Not Found', { status: 404 })
      }
      return new Response(JSON.stringify(subscription), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default SaaS
