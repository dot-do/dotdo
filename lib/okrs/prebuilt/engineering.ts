/**
 * Pre-built Engineering OKRs
 *
 * Engineering metrics owned by Ralph (Engineer) and Tom (Tech Lead):
 * - BuildVelocity: Story points delivered per sprint
 * - CodeQuality: Combined test coverage and lint score
 * - SystemReliability: System uptime percentage
 * - ReviewThroughput: PRs reviewed per week
 */

import { defineMetric } from '../define'

/**
 * BuildVelocity metric - measures story points delivered per sprint.
 *
 * This metric tracks the team's velocity in terms of story points
 * completed during a sprint. Higher values indicate greater throughput.
 *
 * @example
 * ```typescript
 * const result = await BuildVelocity.measurement(analytics)
 * // Returns: 42 (meaning 42 story points delivered this sprint)
 * ```
 */
export const BuildVelocity = defineMetric({
  name: 'BuildVelocity',
  description: 'Story points delivered per sprint',
  unit: 'points',
  measurement: async (analytics) => analytics.engineering!.storyPointsPerSprint,
})

/**
 * CodeQuality metric - measures combined test coverage and lint score.
 *
 * This metric aggregates code quality indicators including test coverage
 * percentage and static analysis scores. Higher values indicate healthier codebase.
 *
 * @example
 * ```typescript
 * const result = await CodeQuality.measurement(analytics)
 * // Returns: 87.5 (meaning 87.5% combined quality score)
 * ```
 */
export const CodeQuality = defineMetric({
  name: 'CodeQuality',
  description: 'Combined test coverage and lint score',
  unit: '%',
  measurement: async (analytics) => analytics.engineering!.codeQualityScore,
})

/**
 * SystemReliability metric - measures system uptime percentage.
 *
 * This metric tracks the percentage of time the system is operational
 * and available to users. Industry standard SLAs target 99.9%+ uptime.
 *
 * @example
 * ```typescript
 * const result = await SystemReliability.measurement(analytics)
 * // Returns: 99.95 (meaning 99.95% uptime)
 * ```
 */
export const SystemReliability = defineMetric({
  name: 'SystemReliability',
  description: 'System uptime percentage',
  unit: '%',
  measurement: async (analytics) => analytics.engineering!.uptimePercentage,
})

/**
 * ReviewThroughput metric - measures PRs reviewed per week.
 *
 * This metric tracks code review velocity, indicating how quickly
 * the team processes pull requests. Healthy throughput prevents bottlenecks.
 *
 * @example
 * ```typescript
 * const result = await ReviewThroughput.measurement(analytics)
 * // Returns: 25 (meaning 25 PRs reviewed this week)
 * ```
 */
export const ReviewThroughput = defineMetric({
  name: 'ReviewThroughput',
  description: 'PRs reviewed per week',
  unit: 'count',
  measurement: async (analytics) => analytics.engineering!.prsReviewedPerWeek,
})

/**
 * EngineeringOKRs - Collection of all Engineering metrics.
 *
 * Use this object to access all pre-built Engineering metrics
 * or iterate over them programmatically.
 *
 * @example
 * ```typescript
 * import { EngineeringOKRs } from 'lib/okrs/prebuilt/engineering'
 *
 * // Access individual metrics
 * const velocity = await EngineeringOKRs.BuildVelocity.measurement(analytics)
 *
 * // Calculate engineering health
 * const quality = await EngineeringOKRs.CodeQuality.measurement(analytics)
 * const reliability = await EngineeringOKRs.SystemReliability.measurement(analytics)
 *
 * // Iterate over all metrics
 * for (const [name, metric] of Object.entries(EngineeringOKRs)) {
 *   console.log(name, metric.description, metric.unit)
 * }
 * ```
 */
export const EngineeringOKRs = {
  BuildVelocity,
  CodeQuality,
  SystemReliability,
  ReviewThroughput,
}
