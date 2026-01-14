/**
 * Engineering Role Definition
 *
 * Engineering role with BuildVelocity, CodeQuality OKRs.
 * Capabilities: build, implement, fix, refactor.
 *
 * @see dotdo-smjp0 - TDD: Engineering role
 * @module roles/engineering
 */

import { defineRole } from './define'

/**
 * Engineering role
 *
 * Responsible for building and maintaining code with high velocity and quality.
 *
 * @example
 * ```typescript
 * import { engineering } from './roles/engineering'
 *
 * // Build a feature
 * await engineering`build the authentication system`
 *
 * // Fix a bug
 * await engineering`fix the memory leak in ${component}`
 * ```
 */
export const engineering = defineRole({
  name: 'engineering',
  okrs: ['BuildVelocity', 'CodeQuality'],
  capabilities: ['build', 'implement', 'fix', 'refactor'],
})
