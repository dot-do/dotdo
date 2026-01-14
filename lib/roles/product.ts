/**
 * Product Role Definition
 *
 * Product management role optimizing for feature adoption, user satisfaction,
 * and time to value.
 *
 * @see dotdo-pmbdz - TDD: Product role
 * @module roles/product
 */

import { defineRole } from './define'

/**
 * Product role with OKRs focused on product success metrics
 *
 * @example
 * ```typescript
 * import { product } from './roles/product'
 *
 * // Template literal invocation
 * await product`define the MVP for user onboarding`
 *
 * // With interpolation
 * const feature = 'checkout flow'
 * await product`prioritize ${feature} for Q1 roadmap`
 * ```
 */
export const product = defineRole({
  name: 'product',
  okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
  capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
})
