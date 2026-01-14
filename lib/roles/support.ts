/**
 * Support Role Definition
 *
 * Customer support role optimizing for response time, resolution rate,
 * and customer satisfaction.
 *
 * @see dotdo-ht9rk - TDD: Support role
 * @module roles/support
 */

import { defineRole } from './define'

/**
 * Support role with OKRs focused on customer success metrics
 *
 * @example
 * ```typescript
 * import { support } from './roles/support'
 *
 * // Template literal invocation
 * await support`help customer with billing issue`
 *
 * // With interpolation
 * const ticketId = 'TICKET-123'
 * await support`resolve ${ticketId} urgently`
 * ```
 */
export const support = defineRole({
  name: 'support',
  okrs: ['ResponseTime', 'ResolutionRate', 'CustomerSatisfaction'],
  capabilities: ['respond', 'resolve', 'escalate'],
})
