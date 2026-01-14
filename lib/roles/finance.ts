/**
 * Finance Role
 *
 * Role responsible for financial operations with focus on
 * burn efficiency and unit economics optimization.
 *
 * @see dotdo-ysru5 - TDD: Finance role
 * @module roles/finance
 */

import { defineRole } from './define'

/**
 * Finance role with OKRs and capabilities for financial management
 *
 * @example
 * ```typescript
 * import { finance } from './roles/finance'
 *
 * // Template literal invocation
 * await finance`create quarterly budget`
 *
 * // With interpolation
 * await finance`forecast revenue for ${quarter} ${year}`
 * ```
 */
export const finance = defineRole({
  name: 'finance',
  okrs: ['BurnEfficiency', 'UnitEconomics'],
  capabilities: ['budget', 'forecast', 'invoice', 'analyze'],
})
