/**
 * Marketing Role Definition
 *
 * Marketing role optimizing for brand awareness, content engagement,
 * and lead generation.
 *
 * @see dotdo-e0koz - TDD: Marketing role
 * @module roles/marketing
 */

import { defineRole } from './define'

/**
 * Marketing role with OKRs focused on brand and growth metrics
 *
 * @example
 * ```typescript
 * import { marketing } from './roles/marketing'
 *
 * // Template literal invocation
 * await marketing`write blog post about product launch`
 *
 * // With interpolation
 * const campaign = 'Q1 Launch'
 * await marketing`announce ${campaign} on all channels`
 * ```
 */
export const marketing = defineRole({
  name: 'marketing',
  okrs: ['BrandAwareness', 'ContentEngagement', 'LeadGeneration'],
  capabilities: ['write', 'announce', 'launch'],
})
