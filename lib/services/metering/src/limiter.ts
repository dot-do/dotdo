/**
 * Usage Limiter Module
 *
 * Enforces usage limits with soft (warn) and hard (block) limits.
 * Supports grace periods and alert thresholds.
 *
 * @module services/metering/limiter
 */

import type {
  UsageLimit,
  LimitCheckResult,
  CounterStorage,
  CounterKey,
  BillingPeriod,
  MeteringService,
} from './types'
import { getPeriodStart, getPeriodEnd } from './counter'

// ============================================================================
// Limiter Key Utilities
// ============================================================================

/**
 * Generate a unique key for a limit
 */
function limitKey(agentId: string, service: string, metric: string): string {
  return `${agentId}:${service}:${metric}`
}

// ============================================================================
// Usage Limiter
// ============================================================================

/**
 * Usage limiter for enforcing quotas
 */
export class UsageLimiter {
  private limits: Map<string, UsageLimit> = new Map()

  constructor(private storage: CounterStorage) {}

  /**
   * Set a usage limit for an agent
   */
  setLimit(agentId: string, limit: UsageLimit): void {
    const key = limitKey(agentId, limit.service, limit.metric)
    this.limits.set(key, limit)
  }

  /**
   * Remove a usage limit
   */
  removeLimit(agentId: string, service: MeteringService, metric: string): void {
    const key = limitKey(agentId, service, metric)
    this.limits.delete(key)
  }

  /**
   * Get a specific limit
   */
  getLimit(agentId: string, service: MeteringService, metric: string): UsageLimit | undefined {
    const key = limitKey(agentId, service, metric)
    return this.limits.get(key)
  }

  /**
   * Get all limits for an agent
   */
  getAgentLimits(agentId: string): UsageLimit[] {
    const prefix = `${agentId}:`
    const result: UsageLimit[] = []

    for (const [key, limit] of this.limits) {
      if (key.startsWith(prefix)) {
        result.push(limit)
      }
    }

    return result
  }

  /**
   * Check if an operation is allowed against the limit
   */
  async checkLimit(
    agentId: string,
    service: MeteringService,
    metric: string
  ): Promise<LimitCheckResult> {
    const limit = this.getLimit(agentId, service, metric)

    // No limit configured - allow unlimited
    if (!limit) {
      return {
        allowed: true,
        current: 0,
        quota: Infinity,
        percentUsed: 0,
        type: 'hard',
        resetsAt: new Date(Date.now() + 86400000), // 24 hours from now
      }
    }

    const periodStart = this.getPeriodStart(limit.period)
    const periodEnd = getPeriodEnd(limit.period)

    const counterKey: CounterKey = {
      agentId,
      service,
      metric,
      period: limit.period,
      periodTimestamp: periodStart,
    }

    const current = await this.storage.get(counterKey)
    const percentUsed = current / limit.quota

    const result: LimitCheckResult = {
      allowed: true,
      current,
      quota: limit.quota,
      percentUsed,
      type: limit.type,
      resetsAt: periodEnd,
    }

    // Check if limit is exceeded
    if (limit.type === 'hard') {
      // Hard limit - block if at or over quota
      if (current >= limit.quota) {
        result.allowed = false
        result.reason = `Hard limit exceeded: ${current} / ${limit.quota} ${metric}`
      }
    } else {
      // Soft limit - allow with grace period
      const gracePeriod = limit.gracePeriod ?? 0
      const graceLimit = limit.quota * (1 + gracePeriod)

      if (current >= graceLimit) {
        result.allowed = false
        result.reason = `Soft limit grace period exceeded: ${current} / ${graceLimit} ${metric}`
      } else if (current >= limit.quota) {
        result.warning = `Soft limit exceeded (in grace period): ${current} / ${limit.quota} ${metric}`
      }
    }

    // Check alert threshold
    const alertThreshold = limit.alertThreshold ?? 0.8
    if (percentUsed >= alertThreshold && percentUsed < 1 && !result.warning) {
      result.warning = `Approaching limit (${Math.round(percentUsed * 100)}%): ${current} / ${limit.quota} ${metric}`
    }

    return result
  }

  /**
   * Check limit and increment in one atomic operation
   * Returns the new value if allowed, or throws if limit exceeded
   */
  async checkAndIncrement(
    agentId: string,
    service: MeteringService,
    metric: string,
    amount: number
  ): Promise<{ newValue: number; result: LimitCheckResult }> {
    // First check the limit
    const checkResult = await this.checkLimit(agentId, service, metric)

    if (!checkResult.allowed) {
      throw new LimitExceededError(checkResult)
    }

    // Get the limit to determine the period
    const limit = this.getLimit(agentId, service, metric)
    const period = limit?.period ?? 'monthly'
    const periodStart = this.getPeriodStart(period)

    const counterKey: CounterKey = {
      agentId,
      service,
      metric,
      period,
      periodTimestamp: periodStart,
    }

    // Increment the counter
    const newValue = await this.storage.increment(counterKey, amount)

    // Update the result with new values
    checkResult.current = newValue
    if (limit) {
      checkResult.percentUsed = newValue / limit.quota

      // Check if we crossed the alert threshold after increment
      const alertThreshold = limit.alertThreshold ?? 0.8
      if (checkResult.percentUsed >= alertThreshold && !checkResult.warning) {
        checkResult.warning = `Approaching limit (${Math.round(checkResult.percentUsed * 100)}%): ${newValue} / ${limit.quota} ${metric}`
      }
    }

    return { newValue, result: checkResult }
  }

  /**
   * Get the start of the current period
   */
  getPeriodStart(period: BillingPeriod): Date {
    return getPeriodStart(period)
  }

  /**
   * Get current usage for an agent/service/metric
   */
  async getCurrentUsage(
    agentId: string,
    service: MeteringService,
    metric: string,
    period: BillingPeriod = 'monthly'
  ): Promise<number> {
    const counterKey: CounterKey = {
      agentId,
      service,
      metric,
      period,
      periodTimestamp: this.getPeriodStart(period),
    }

    return this.storage.get(counterKey)
  }

  /**
   * Get all current usage for an agent
   */
  async getAllUsage(agentId: string, period: BillingPeriod = 'monthly'): Promise<Map<string, number>> {
    return this.storage.getAll(agentId, period)
  }
}

// ============================================================================
// Limit Exceeded Error
// ============================================================================

/**
 * Error thrown when a usage limit is exceeded
 */
export class LimitExceededError extends Error {
  constructor(public readonly result: LimitCheckResult) {
    super(result.reason || 'Usage limit exceeded')
    this.name = 'LimitExceededError'
  }
}

// ============================================================================
// Default Limits
// ============================================================================

/**
 * Default limits for free tier
 */
export const FREE_TIER_LIMITS: UsageLimit[] = [
  {
    service: 'llm.do',
    metric: 'tokens',
    quota: 100000, // 100k tokens
    period: 'monthly',
    type: 'hard',
    alertThreshold: 0.8,
  },
  {
    service: 'llm.do',
    metric: 'requests',
    quota: 1000,
    period: 'monthly',
    type: 'hard',
    alertThreshold: 0.8,
  },
  {
    service: 'emails.do',
    metric: 'sent',
    quota: 100,
    period: 'daily',
    type: 'soft',
    gracePeriod: 0.1,
    alertThreshold: 0.8,
  },
  {
    service: 'texts.do',
    metric: 'sent',
    quota: 50,
    period: 'daily',
    type: 'hard',
    alertThreshold: 0.8,
  },
  {
    service: 'calls.do',
    metric: 'minutes',
    quota: 100,
    period: 'monthly',
    type: 'hard',
    alertThreshold: 0.8,
  },
  {
    service: 'queue.do',
    metric: 'messages',
    quota: 10000,
    period: 'daily',
    type: 'soft',
    gracePeriod: 0.2,
    alertThreshold: 0.8,
  },
]

/**
 * Default limits for pro tier
 */
export const PRO_TIER_LIMITS: UsageLimit[] = [
  {
    service: 'llm.do',
    metric: 'tokens',
    quota: 1000000, // 1M tokens
    period: 'monthly',
    type: 'soft',
    gracePeriod: 0.1,
    alertThreshold: 0.9,
  },
  {
    service: 'llm.do',
    metric: 'requests',
    quota: 10000,
    period: 'monthly',
    type: 'soft',
    gracePeriod: 0.1,
    alertThreshold: 0.9,
  },
  {
    service: 'emails.do',
    metric: 'sent',
    quota: 1000,
    period: 'daily',
    type: 'soft',
    gracePeriod: 0.2,
    alertThreshold: 0.9,
  },
  {
    service: 'texts.do',
    metric: 'sent',
    quota: 500,
    period: 'daily',
    type: 'soft',
    gracePeriod: 0.1,
    alertThreshold: 0.9,
  },
  {
    service: 'calls.do',
    metric: 'minutes',
    quota: 1000,
    period: 'monthly',
    type: 'soft',
    gracePeriod: 0.1,
    alertThreshold: 0.9,
  },
  {
    service: 'queue.do',
    metric: 'messages',
    quota: 100000,
    period: 'daily',
    type: 'soft',
    gracePeriod: 0.2,
    alertThreshold: 0.9,
  },
]

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create limiter with free tier defaults
 */
export function createFreeTierLimiter(storage: CounterStorage, agentId: string): UsageLimiter {
  const limiter = new UsageLimiter(storage)
  for (const limit of FREE_TIER_LIMITS) {
    limiter.setLimit(agentId, limit)
  }
  return limiter
}

/**
 * Create limiter with pro tier defaults
 */
export function createProTierLimiter(storage: CounterStorage, agentId: string): UsageLimiter {
  const limiter = new UsageLimiter(storage)
  for (const limit of PRO_TIER_LIMITS) {
    limiter.setLimit(agentId, limit)
  }
  return limiter
}

/**
 * Create limiter with custom limits
 */
export function createCustomLimiter(
  storage: CounterStorage,
  agentId: string,
  limits: UsageLimit[]
): UsageLimiter {
  const limiter = new UsageLimiter(storage)
  for (const limit of limits) {
    limiter.setLimit(agentId, limit)
  }
  return limiter
}
