/**
 * Pre-built Product OKRs
 *
 * Product metrics owned by Priya (Product Manager):
 * - FeatureAdoption: % users using new features
 * - UserSatisfaction: NPS/CSAT scores
 * - TimeToValue: Onboarding completion time
 */

import { defineMetric } from '../define'

/**
 * FeatureAdoption metric - measures % of users using new features.
 *
 * This metric tracks how well new features are being adopted by users.
 * Higher values indicate better product-market fit and effective feature discovery.
 *
 * @example
 * ```typescript
 * const result = await FeatureAdoption.measurement(analytics)
 * // Returns: 75.5 (meaning 75.5% of users have adopted new features)
 * ```
 */
export const FeatureAdoption = defineMetric({
  name: 'FeatureAdoption',
  description: '% users using new features',
  unit: '%',
  measurement: async (analytics) => analytics.product.featureAdoptionRate,
})

/**
 * UserSatisfaction metric - measures NPS/CSAT scores.
 *
 * This metric tracks overall user satisfaction through Net Promoter Score
 * or Customer Satisfaction surveys. Can range from -100 to 100 for NPS.
 *
 * @example
 * ```typescript
 * const result = await UserSatisfaction.measurement(analytics)
 * // Returns: 85 (NPS score)
 * ```
 */
export const UserSatisfaction = defineMetric({
  name: 'UserSatisfaction',
  description: 'NPS/CSAT scores',
  unit: 'score',
  measurement: async (analytics) => analytics.product.userSatisfactionScore,
})

/**
 * TimeToValue metric - measures onboarding completion time.
 *
 * This metric tracks how long it takes for users to reach their first
 * value moment after signup. Lower values indicate better onboarding experience.
 *
 * @example
 * ```typescript
 * const result = await TimeToValue.measurement(analytics)
 * // Returns: 15 (meaning average 15 minutes to complete onboarding)
 * ```
 */
export const TimeToValue = defineMetric({
  name: 'TimeToValue',
  description: 'Onboarding completion time',
  unit: 'minutes',
  measurement: async (analytics) => analytics.product.onboardingCompletionTime,
})

/**
 * ProductOKRs - Collection of all Product metrics.
 *
 * Use this object to access all pre-built Product metrics
 * or iterate over them programmatically.
 *
 * @example
 * ```typescript
 * import { ProductOKRs } from 'lib/okrs/prebuilt/product'
 *
 * // Access individual metrics
 * const adoption = await ProductOKRs.FeatureAdoption.measurement(analytics)
 *
 * // Iterate over all metrics
 * for (const [name, metric] of Object.entries(ProductOKRs)) {
 *   console.log(name, metric.description)
 * }
 * ```
 */
export const ProductOKRs = {
  FeatureAdoption,
  UserSatisfaction,
  TimeToValue,
}
