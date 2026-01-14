/**
 * Pre-built Growth OKRs
 *
 * Growth metrics owned by Mark (Marketing):
 * - BrandAwareness: Traffic, social reach
 * - ContentEngagement: Views, shares, time on page
 * - LeadGeneration: MQLs generated
 *
 * These metrics compute from web analytics data and are essential
 * for tracking marketing effectiveness and growth trajectory.
 */

import { defineMetric } from '../define'

/**
 * BrandAwareness metric - measures traffic and social reach.
 *
 * This metric tracks the combined reach of your brand through
 * website traffic and social media impressions. Higher values
 * indicate broader brand visibility and market presence.
 *
 * @example
 * ```typescript
 * const result = await BrandAwareness.measurement(analytics)
 * // Returns: 150000 (combined traffic + social reach)
 * ```
 */
export const BrandAwareness = defineMetric({
  name: 'BrandAwareness',
  description: 'Traffic and social reach',
  unit: 'count',
  measurement: async (analytics) => analytics.growth!.brandAwareness,
})

/**
 * ContentEngagement metric - measures views, shares, and time on page.
 *
 * This metric tracks how well your content resonates with the audience
 * through a composite score of page views, social shares, and average
 * time spent on content. Higher scores indicate more engaging content.
 *
 * @example
 * ```typescript
 * const result = await ContentEngagement.measurement(analytics)
 * // Returns: 85.5 (engagement score from 0-100)
 * ```
 */
export const ContentEngagement = defineMetric({
  name: 'ContentEngagement',
  description: 'Views, shares, time on page',
  unit: 'score',
  measurement: async (analytics) => analytics.growth!.contentEngagement,
})

/**
 * LeadGeneration metric - measures MQLs generated.
 *
 * This metric tracks Marketing Qualified Leads generated through
 * content, campaigns, and inbound marketing efforts. Essential for
 * measuring the effectiveness of the marketing funnel.
 *
 * @example
 * ```typescript
 * const result = await LeadGeneration.measurement(analytics)
 * // Returns: 500 (number of MQLs generated)
 * ```
 */
export const LeadGeneration = defineMetric({
  name: 'LeadGeneration',
  description: 'MQLs generated',
  unit: 'count',
  measurement: async (analytics) => analytics.growth!.leadGeneration,
})

/**
 * GrowthOKRs - Collection of all Growth metrics.
 *
 * Use this object to access all pre-built Growth metrics
 * or iterate over them programmatically.
 *
 * @example
 * ```typescript
 * import { GrowthOKRs } from 'lib/okrs/prebuilt/growth'
 *
 * // Access individual metrics
 * const awareness = await GrowthOKRs.BrandAwareness.measurement(analytics)
 *
 * // Iterate over all metrics
 * for (const [name, metric] of Object.entries(GrowthOKRs)) {
 *   console.log(name, metric.description)
 * }
 * ```
 */
export const GrowthOKRs = {
  BrandAwareness,
  ContentEngagement,
  LeadGeneration,
}
