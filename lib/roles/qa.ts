/**
 * QA Role Definition
 *
 * Quality assurance role optimizing for test coverage and defect escape rate.
 *
 * @see dotdo-q6sxp - TDD: QA role
 * @module roles/qa
 */

import { defineRole } from './define'

/**
 * QA role with OKRs focused on quality metrics
 *
 * @example
 * ```typescript
 * import { qa } from './roles/qa'
 *
 * // Template literal invocation
 * await qa`test the authentication flow`
 *
 * // With interpolation
 * const feature = 'user-registration'
 * await qa`validate ${feature} with full coverage`
 * ```
 */
export const qa = defineRole({
  name: 'qa',
  okrs: ['TestCoverage', 'DefectEscapeRate'],
  capabilities: ['test', 'validate', 'verify'],
})
