/**
 * Data/Analytics Role Definition
 *
 * The data role handles analytics, reporting, visualization, and data queries.
 * Optimizes for dashboard accuracy and timely insight delivery.
 *
 * @see dotdo-z40yl - TDD: Data/Analytics role
 * @module roles/data
 */

import { defineRole } from './define'

/**
 * Data/Analytics role
 *
 * OKRs:
 * - DashboardAccuracy: Ensuring data visualizations and reports are accurate
 * - InsightDelivery: Timely delivery of actionable insights
 *
 * Capabilities:
 * - analyze: Perform data analysis and statistical computations
 * - report: Generate reports from data sources
 * - visualize: Create data visualizations and charts
 * - query: Execute data queries and aggregations
 *
 * @example
 * ```typescript
 * import { data } from './roles/data'
 *
 * // Template literal invocation
 * await data`analyze user engagement metrics for Q4`
 *
 * // With interpolation
 * const metric = 'conversion rate'
 * await data`create a dashboard for ${metric}`
 * ```
 */
export const data = defineRole({
  name: 'data',
  okrs: ['DashboardAccuracy', 'InsightDelivery'],
  capabilities: ['analyze', 'report', 'visualize', 'query'],
})
