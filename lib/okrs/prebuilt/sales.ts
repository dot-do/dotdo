/**
 * Pre-built Sales OKRs
 *
 * Sales metrics owned by Sally (Sales Lead):
 * - PipelineHealth: Qualified opportunities in sales pipeline
 * - ConversionRate: Demo to Close conversion percentage
 * - RevenueGrowth: MRR/ARR growth rate
 */

import { defineMetric } from '../define'

/**
 * PipelineHealth metric - measures qualified opportunities in pipeline.
 *
 * This metric tracks the number of qualified opportunities currently
 * in the sales pipeline. Higher values indicate a healthier pipeline
 * and better lead qualification.
 *
 * @example
 * ```typescript
 * const result = await PipelineHealth.measurement(analytics)
 * // Returns: 45 (meaning 45 qualified opportunities)
 * ```
 */
export const PipelineHealth = defineMetric({
  name: 'PipelineHealth',
  description: 'Qualified opportunities in pipeline',
  unit: 'count',
  measurement: async (analytics) => analytics.sales!.qualifiedOpportunities,
})

/**
 * ConversionRate metric - measures demo to close conversion percentage.
 *
 * This metric tracks the percentage of demos that convert to closed deals.
 * Higher values indicate more effective sales process and demos.
 *
 * @example
 * ```typescript
 * const result = await ConversionRate.measurement(analytics)
 * // Returns: 25.5 (meaning 25.5% of demos convert to closed deals)
 * ```
 */
export const ConversionRate = defineMetric({
  name: 'ConversionRate',
  description: 'Demo to Close conversion rate',
  unit: '%',
  measurement: async (analytics) => analytics.sales!.demoToCloseRate,
})

/**
 * RevenueGrowth metric - measures MRR/ARR growth rate.
 *
 * This metric tracks the month-over-month or year-over-year growth
 * in recurring revenue. Positive values indicate growth, negative
 * values indicate contraction.
 *
 * @example
 * ```typescript
 * const result = await RevenueGrowth.measurement(analytics)
 * // Returns: 15 (meaning 15% revenue growth)
 * ```
 */
export const RevenueGrowth = defineMetric({
  name: 'RevenueGrowth',
  description: 'MRR/ARR growth rate',
  unit: '%',
  measurement: async (analytics) => analytics.sales!.revenueGrowthRate,
})

/**
 * SalesOKRs - Collection of all Sales metrics.
 *
 * Use this object to access all pre-built Sales metrics
 * or iterate over them programmatically.
 *
 * @example
 * ```typescript
 * import { SalesOKRs } from 'lib/okrs/prebuilt/sales'
 *
 * // Access individual metrics
 * const pipeline = await SalesOKRs.PipelineHealth.measurement(analytics)
 *
 * // Iterate over all metrics
 * for (const [name, metric] of Object.entries(SalesOKRs)) {
 *   console.log(name, metric.description)
 * }
 * ```
 */
export const SalesOKRs = {
  PipelineHealth,
  ConversionRate,
  RevenueGrowth,
}
