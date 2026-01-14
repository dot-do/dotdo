/**
 * Pre-built Support & Customer Success OKRs
 *
 * Support metrics (owned by Sam):
 * - ResponseTime: First response SLA
 * - ResolutionRate: % resolved without escalation
 * - CustomerSatisfaction: Support CSAT
 *
 * Customer Success metrics (owned by Casey):
 * - NetRetention: NRR %
 * - ExpansionRevenue: Upsell/cross-sell
 * - ChurnPrevention: At-risk accounts saved
 *
 * These metrics are essential for tracking support quality and customer success
 * health, helping teams maintain SLAs and reduce churn.
 */

import { defineMetric } from '../define'

// ============================================================================
// Support OKRs (owned by Sam)
// ============================================================================

/**
 * ResponseTime metric - measures first response SLA in minutes.
 *
 * Tracks how quickly support agents respond to new tickets.
 * Lower response times indicate better support responsiveness.
 *
 * @example
 * ```typescript
 * const result = await ResponseTime.measurement(analytics)
 * // Returns: 15 (meaning 15 minutes average first response time)
 * ```
 */
export const ResponseTime = defineMetric({
  name: 'ResponseTime',
  description: 'First response SLA',
  unit: 'minutes',
  measurement: async (analytics) => analytics.support.firstResponseTime,
})

/**
 * ResolutionRate metric - measures % of tickets resolved without escalation.
 *
 * Tracks the percentage of support tickets that are resolved by the first-level
 * support team without needing to escalate to engineering or management.
 * Higher rates indicate better frontline support effectiveness.
 *
 * @example
 * ```typescript
 * const result = await ResolutionRate.measurement(analytics)
 * // Returns: 85 (meaning 85% of tickets resolved without escalation)
 * ```
 */
export const ResolutionRate = defineMetric({
  name: 'ResolutionRate',
  description: '% resolved without escalation',
  unit: '%',
  measurement: async (analytics) => analytics.support.resolutionRate,
})

/**
 * CustomerSatisfaction metric - measures Support CSAT score.
 *
 * Tracks customer satisfaction with support interactions, typically
 * measured on a 1-5 scale after ticket resolution.
 *
 * @example
 * ```typescript
 * const result = await CustomerSatisfaction.measurement(analytics)
 * // Returns: 4.5 (meaning 4.5/5 average CSAT score)
 * ```
 */
export const CustomerSatisfaction = defineMetric({
  name: 'CustomerSatisfaction',
  description: 'Support CSAT',
  unit: 'score',
  measurement: async (analytics) => analytics.support.csat,
})

/**
 * SupportOKRs - Collection of all Support metrics.
 *
 * Use this object to access all pre-built Support metrics
 * or iterate over them programmatically.
 *
 * @example
 * ```typescript
 * import { SupportOKRs } from 'lib/okrs/prebuilt/support'
 *
 * // Access individual metrics
 * const responseTime = await SupportOKRs.ResponseTime.measurement(analytics)
 *
 * // Iterate over all metrics
 * for (const [name, metric] of Object.entries(SupportOKRs)) {
 *   console.log(name, metric.description, metric.unit)
 * }
 * ```
 */
export const SupportOKRs = {
  ResponseTime,
  ResolutionRate,
  CustomerSatisfaction,
}

// ============================================================================
// Customer Success OKRs (owned by Casey)
// ============================================================================

/**
 * NetRetention metric - measures Net Revenue Retention (NRR) percentage.
 *
 * Tracks revenue retained from existing customers including expansions,
 * contractions, and churn. Values above 100% indicate net expansion.
 *
 * @example
 * ```typescript
 * const result = await NetRetention.measurement(analytics)
 * // Returns: 115 (meaning 115% NRR - net expansion)
 * ```
 */
export const NetRetention = defineMetric({
  name: 'NetRetention',
  description: 'NRR %',
  unit: '%',
  measurement: async (analytics) => analytics.customerSuccess.netRetentionRate,
})

/**
 * ExpansionRevenue metric - measures upsell/cross-sell revenue.
 *
 * Tracks additional revenue generated from existing customers through
 * plan upgrades, seat additions, or cross-selling additional products.
 *
 * @example
 * ```typescript
 * const result = await ExpansionRevenue.measurement(analytics)
 * // Returns: 50000 (meaning $50,000 expansion revenue)
 * ```
 */
export const ExpansionRevenue = defineMetric({
  name: 'ExpansionRevenue',
  description: 'Upsell/cross-sell',
  unit: '$',
  measurement: async (analytics) => analytics.customerSuccess.expansionRevenue,
})

/**
 * ChurnPrevention metric - measures at-risk accounts saved.
 *
 * Tracks the number of customer accounts that were identified as at-risk
 * of churning but were successfully retained through intervention.
 *
 * @example
 * ```typescript
 * const result = await ChurnPrevention.measurement(analytics)
 * // Returns: 25 (meaning 25 at-risk accounts were saved)
 * ```
 */
export const ChurnPrevention = defineMetric({
  name: 'ChurnPrevention',
  description: 'At-risk accounts saved',
  unit: 'count',
  measurement: async (analytics) => analytics.customerSuccess.savedAccounts,
})

/**
 * CustomerSuccessOKRs - Collection of all Customer Success metrics.
 *
 * Use this object to access all pre-built Customer Success metrics
 * or iterate over them programmatically.
 *
 * @example
 * ```typescript
 * import { CustomerSuccessOKRs } from 'lib/okrs/prebuilt/support'
 *
 * // Access individual metrics
 * const nrr = await CustomerSuccessOKRs.NetRetention.measurement(analytics)
 *
 * // Calculate total customer value retained
 * const retention = await CustomerSuccessOKRs.NetRetention.measurement(analytics)
 * const expansion = await CustomerSuccessOKRs.ExpansionRevenue.measurement(analytics)
 *
 * // Iterate over all metrics
 * for (const [name, metric] of Object.entries(CustomerSuccessOKRs)) {
 *   console.log(name, metric.description)
 * }
 * ```
 */
export const CustomerSuccessOKRs = {
  NetRetention,
  ExpansionRevenue,
  ChurnPrevention,
}
