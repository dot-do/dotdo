/**
 * Pre-built SaaS OKRs
 *
 * Core SaaS business metrics:
 * - MRR: Monthly Recurring Revenue
 * - Churn: Monthly Churn Rate
 * - NRR: Net Revenue Retention
 * - CAC: Customer Acquisition Cost
 * - LTV: Customer Lifetime Value
 *
 * These metrics are essential for tracking SaaS business health
 * and are typically owned by Finance (Finn) and Customer Success (Casey).
 */

import { defineMetric } from '../define'

/**
 * MRR (Monthly Recurring Revenue) metric.
 *
 * The total predictable revenue from active subscriptions per month.
 * This is the core health metric for any SaaS business.
 *
 * @example
 * ```typescript
 * const result = await MRR.measurement(analytics)
 * // Returns: 75000 (meaning $75,000 MRR)
 * ```
 */
export const MRR = defineMetric({
  name: 'MRR',
  description: 'Monthly Recurring Revenue',
  unit: '$',
  measurement: async (analytics) => analytics.financial.mrr,
})

/**
 * Churn metric - Monthly Churn Rate (%).
 *
 * The percentage of customers or revenue lost per month.
 * Lower churn rates indicate better customer retention and product-market fit.
 *
 * @example
 * ```typescript
 * const result = await Churn.measurement(analytics)
 * // Returns: 3.5 (meaning 3.5% monthly churn)
 * ```
 */
export const Churn = defineMetric({
  name: 'Churn',
  description: 'Monthly Churn Rate',
  unit: '%',
  measurement: async (analytics) => analytics.financial.churn,
})

/**
 * NRR (Net Revenue Retention) metric.
 *
 * Measures revenue retained from existing customers including expansions,
 * contractions, and churn. Values above 100% indicate net expansion.
 *
 * @example
 * ```typescript
 * const result = await NRR.measurement(analytics)
 * // Returns: 115 (meaning 115% NRR - net expansion)
 * ```
 */
export const NRR = defineMetric({
  name: 'NRR',
  description: 'Net Revenue Retention',
  unit: '%',
  measurement: async (analytics) => analytics.financial.nrr,
})

/**
 * CAC (Customer Acquisition Cost) metric.
 *
 * The average cost to acquire a new customer, including sales
 * and marketing expenses. Lower CAC improves unit economics.
 *
 * @example
 * ```typescript
 * const result = await CAC.measurement(analytics)
 * // Returns: 250 (meaning $250 average CAC)
 * ```
 */
export const CAC = defineMetric({
  name: 'CAC',
  description: 'Customer Acquisition Cost',
  unit: '$',
  measurement: async (analytics) => analytics.financial.cac,
})

/**
 * LTV (Customer Lifetime Value) metric.
 *
 * The total revenue expected from a customer over their lifetime.
 * LTV:CAC ratio should be at least 3:1 for healthy unit economics.
 *
 * @example
 * ```typescript
 * const result = await LTV.measurement(analytics)
 * // Returns: 3000 (meaning $3,000 average LTV)
 * ```
 */
export const LTV = defineMetric({
  name: 'LTV',
  description: 'Customer Lifetime Value',
  unit: '$',
  measurement: async (analytics) => analytics.financial.ltv,
})

/**
 * SaaSKRs - Collection of all SaaS Key Results.
 *
 * Use this object to access all pre-built SaaS metrics
 * or iterate over them programmatically.
 *
 * @example
 * ```typescript
 * import { SaaSKRs } from 'lib/okrs/prebuilt/saas'
 *
 * // Access individual metrics
 * const mrr = await SaaSKRs.MRR.measurement(analytics)
 *
 * // Calculate LTV:CAC ratio
 * const ltv = await SaaSKRs.LTV.measurement(analytics)
 * const cac = await SaaSKRs.CAC.measurement(analytics)
 * const ratio = ltv / cac
 *
 * // Iterate over all metrics
 * for (const [name, metric] of Object.entries(SaaSKRs)) {
 *   console.log(name, metric.description, metric.unit)
 * }
 * ```
 */
export const SaaSKRs = {
  MRR,
  Churn,
  NRR,
  CAC,
  LTV,
}
