/**
 * Sales Role Definition
 *
 * Sales role optimizing for pipeline health, conversion rate,
 * and revenue growth.
 *
 * @see dotdo-vl3v3 - TDD: Sales role
 * @module roles/sales
 */

import { defineRole } from './define'

/**
 * Sales role with OKRs focused on revenue and pipeline metrics
 *
 * @example
 * ```typescript
 * import { sales } from './roles/sales'
 *
 * // Template literal invocation
 * await sales`reach out to new prospects`
 *
 * // With interpolation
 * const prospect = 'Acme Corp'
 * await sales`close deal with ${prospect}`
 * ```
 */
export const sales = defineRole({
  name: 'sales',
  okrs: ['PipelineHealth', 'ConversionRate', 'RevenueGrowth'],
  capabilities: ['outreach', 'demo', 'close', 'handoff'],
})
