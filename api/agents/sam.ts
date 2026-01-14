/**
 * Sam - Support Agent
 *
 * Sam is the support agent implementing the support role.
 * Helps with customer support, ticket handling, and issue resolution.
 *
 * @see dotdo-cdge8 - TDD: Sam agent (support)
 * @module agents/sam
 */

import { defineAgent } from './define'
import { support } from '../../lib/roles/support'

/**
 * Sam - Support Agent
 *
 * Sam implements the support role with capabilities:
 * - respond: Respond to customer inquiries
 * - resolve: Resolve customer issues
 * - escalate: Escalate complex issues to appropriate teams
 *
 * @example
 * ```typescript
 * import { sam } from './agents/sam'
 *
 * // Template literal invocation
 * await sam`handle this ticket`
 *
 * // With interpolation
 * const ticketId = 'TICKET-123'
 * await sam`resolve ${ticketId} urgently`
 * ```
 */
export const sam = defineAgent({
  name: 'Sam',
  domain: 'sam.do',
  role: support,
  persona: { voice: 'helpful', style: 'friendly' },
})
